"""OpenStreetMap Overpass discovery scraper — the primary automated source.

Live-verified: the public Overpass API returns hundreds of real, local
disability/health/social-service facilities per state with names, websites,
phones and addresses, free and key-less. We query each state for
disability-specific POIs, map them to the site schema, and route NEW entries
through save_resources() into the pending review queue (existing entries are
left untouched). No data reaches the live site without admin approval.

Data © OpenStreetMap contributors, ODbL — attribution is rendered in the site
footer (required by the licence).

Config (env):
  TFP_OSM_STATES        comma-separated state codes to limit the sweep
                        (e.g. "VA,OR"); default = all 50 + DC
  TFP_OSM_MAX_PER_STATE cap candidates queued per state (0 = no cap)
  TFP_OSM_DELAY         seconds between state queries (default 2)
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from base_scraper import make_resource, queue_new_resources, all_live_resource_keys
import pending_store
from _category_map import (STATE_NAME, ALL_STATE_CODES, osm_category,
                           is_disability_relevant, is_noise, is_excluded, safe_category)
from _source_health import SourceRun, int_env, float_env

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = ("TheFullestProjectBot/1.0 (+https://thefullestproject.org/about/; "
             "disability resource directory)")

# NOTE: `physiotherapist` is deliberately absent from the healthcare regex below.
# It returned general sports and orthopaedic PT clinics by the hundred — every
# town has several — which buried the review queue without adding
# disability-specific resources. Blocklisting them downstream never kept up,
# because each week's sweep finds different ones. OT and speech therapists are
# still queried: caregivers of children with disabilities actively look for those.
# Braces in this string are .format() placeholders — do not add literal braces.
QUERY_TEMPLATE = """[out:json][timeout:90];
area["ISO3166-2"="US-{code}"][admin_level=4]->.a;
(
  nwr["social_facility:for"~"disabled|autism",i](area.a);
  nwr["healthcare"~"^(rehabilitation|occupational_therapist|speech_therapist)$"](area.a);
  nwr["office"="therapist"](area.a);
  nwr["shop"~"^(mobility|medical_supply)$"](area.a);
);
out center tags;
"""


def _states():
    """Explicit TFP_OSM_STATES, else all 51 rotated by ISO week so that, under a
    run-wide intake cap, coverage spreads across states over successive weeks
    instead of always front-loading the alphabet."""
    env = os.environ.get("TFP_OSM_STATES", "").strip()
    if env:
        return [c.strip().upper() for c in env.split(",") if c.strip().upper() in STATE_NAME]
    states = list(ALL_STATE_CODES)
    offset = date.today().isocalendar()[1] % len(states)  # rotate by week number
    return states[offset:] + states[:offset]


def _fetch_state(code):
    """POST the Overpass query for one state; return elements list or raise."""
    query = QUERY_TEMPLATE.format(code=code)
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_err = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(
                OVERPASS_URL, data=data,
                headers={"User-Agent": USER_AGENT,
                         "Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            return payload.get("elements", [])
        except Exception as e:  # network/parse error: retried once, then surfaced
            last_err = e
            if attempt == 0:
                time.sleep(5)  # back off once before giving up on this state
    raise last_err


def _addr(tags):
    parts = [tags.get("addr:housenumber", ""), tags.get("addr:street", "")]
    line = " ".join(p for p in parts if p).strip()
    return line


def _build_resource(el, code):
    tags = el.get("tags", {})
    name = tags.get("name", "").strip()
    if not name:
        return None

    blob = f"{name} {tags.get('description', '')} {tags.get('operator', '')}"
    if not is_disability_relevant(blob, tags) or is_noise(blob):
        return None
    # Mental-health / chiropractic / behavioral-health services are out of scope.
    if is_excluded(blob, tags):
        return None

    website = tags.get("website") or tags.get("contact:website") or ""
    # Admin decision (2026-07): candidates without a website are skipped —
    # reviewers can't verify them and visitors can't reach them. Set
    # TFP_OSM_REQUIRE_WEBSITE=0 to queue website-less finds anyway.
    if not website.strip() and os.environ.get("TFP_OSM_REQUIRE_WEBSITE", "1") != "0":
        return None
    phone = tags.get("phone") or tags.get("contact:phone") or ""
    osm_type = el.get("type", "node")
    osm_tags = ["osm"]
    for k in ("social_facility", "social_facility:for", "healthcare", "office", "shop"):
        if tags.get(k):
            osm_tags.append(tags[k])
    if tags.get("wheelchair") == "yes":
        osm_tags.append("wheelchair-accessible")

    return make_resource(
        name=name,
        category=safe_category(osm_category(tags) or "other"),
        location=STATE_NAME[code],
        description=tags.get("description", "").strip(),
        website=website.strip(),
        phone=phone.strip(),
        address=_addr(tags),
        area=tags.get("addr:city", "").strip(),
        tags=osm_tags,
        source=f"https://www.openstreetmap.org/{osm_type}/{el.get('id')}",
    )


def _candidates_for_state(code, cap):
    """Fetch + filter one state's elements into deduped candidate resources."""
    elements = _fetch_state(code)
    seen_local = set()
    candidates = []
    for el in elements:
        resource = _build_resource(el, code)
        if not resource:
            continue
        key = (resource["name"].lower(), (resource["website"] or "").lower())
        if key in seen_local:
            continue
        seen_local.add(key)
        candidates.append(resource)
        if cap and len(candidates) >= cap:
            break
    return candidates


def scrape():
    """Sweep states for disability POIs; queue NEW ones for admin review.

    Never writes live data files — only adds candidates to pending/ (existing
    curated entries are left untouched).
    """
    print("Discovering resources via OpenStreetMap Overpass...")
    run = SourceRun("osm_overpass")
    states = _states()
    cap = int_env("TFP_OSM_MAX_PER_STATE", 0)       # per-state cap (0 = none)
    max_total = int_env("TFP_OSM_MAX_TOTAL", 0)     # run-wide cap (0 = none)
    delay = float_env("TFP_OSM_DELAY", 2)
    # Seed dedup with everything already live or pending, once for the whole run.
    seen = all_live_resource_keys() | pending_store.load_pending_keys("resource")
    total_queued = 0

    for i, code in enumerate(states):
        if max_total and total_queued >= max_total:
            print(f"  reached run-wide cap ({max_total}); stopping early at {code}")
            break
        run.attempt()
        try:
            candidates = _candidates_for_state(code, cap)
        except Exception as e:  # per-state failure: logged, surfaced by finish()
            run.fail_target(f"{code}: {e}")
            continue

        run.succeed(seen=len(candidates))
        queued, seen = queue_new_resources(
            candidates, "osm_overpass",
            target_file=f"src/_data/resources/states/{code}.json", seen=seen)
        run.queued(queued)
        total_queued += queued

        if i < len(states) - 1:
            time.sleep(delay)

    run.finish()


if __name__ == "__main__":
    scrape()
