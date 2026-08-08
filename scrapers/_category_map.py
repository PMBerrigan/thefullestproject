"""Shared mapping + relevance helpers for the discovery scrapers.

Lives in scrapers/ (not scrapers/sources/) so run_all.py never auto-runs it.
Maps raw source categories (OSM tags, CMS provider types, news keywords) onto
the site's canonical category slugs and decides whether a candidate is actually
disability-relevant before it reaches the review queue.
"""

# Canonical slugs — MUST stay in sync with src/_data/categories.json
SITE_CATEGORIES = {
    "therapy", "equipment", "education", "recreation", "respite", "employment",
    "nonprofit", "faith", "sensory", "childcare", "legal", "clothing",
    "community", "government", "early-intervention", "transition", "financial",
    "insurance", "planning", "mental-health", "transportation", "housing",
    "medical", "camps", "sibling-support", "assistive-tech", "sports",
    "emergency", "home-modifications", "apps", "other",
}

# US states + DC: code <-> full name. State resource files use the full name
# as `location` (e.g. "Oregon"), keyed by file states/XX.json.
STATE_NAME = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana",
    "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
STATE_CODE = {name: code for code, name in STATE_NAME.items()}
ALL_STATE_CODES = list(STATE_NAME.keys())

# Words that mark a candidate as genuinely disability/caregiver relevant.
RELEVANCE_KEYWORDS = (
    "disability", "disabled", "disabilities", "special needs", "special-needs",
    "autism", "autistic", "asd", "developmental", "intellectual disabilit",
    "idd", "cerebral palsy", "down syndrome", "wheelchair", "accessible",
    "accessibility", "adaptive", "assistive", "rehabilitation", "rehab",
    "therapy", "therapist", "occupational therap", "physical therap",
    "speech therap", "speech-language", "sensory", "deaf", "hard of hearing",
    "blind", "low vision", "visually impair", "hearing impair", "prosthetic",
    "orthotic", "respite", "caregiver", "special education", "early intervention",
    "neurodivergent", "spina bifida",
    "muscular dystrophy", "traumatic brain", "tbi", "paraly", "mobility",
)

# Words that, when present and with NO relevance keyword, mark a row as noise
# (e.g. senior-only or generic services that aren't disability resources).
NOISE_KEYWORDS = (
    "senior center", "retirement", "elderly", "55+", "active adult",
    "funeral", "cemetery", "real estate", "auto repair", "car wash",
)

# Services intentionally OUT of scope for the directory. Candidates that look
# like mental-health counseling, psychiatry, chiropractic, or behavioral-health
# services are dropped before they ever reach the review queue (admin decision
# 2026-07). Note: "mental-health" stays a valid site category for curated/manual
# entries — this only stops the scrapers from queuing NEW ones.
EXCLUDE_KEYWORDS = (
    "chiropract", "psychotherap", "psychiatr", "counseling", "counselling",
    "counselor", "counsellor", "behavioral health", "behavioural health",
    "mental health", "mental-health",
)
EXCLUDE_HEALTHCARE = {"psychotherapist", "counselling", "psychiatry", "psychiatrist"}
EXCLUDE_SOCIAL_FOR = {"mental_health"}


def is_excluded(text, tags=None):
    """True if a candidate is an out-of-scope mental-health / chiropractic /
    behavioral-health service that should NOT be scraped into the queue."""
    blob = (text or "").lower()
    tags = tags or {}
    if tags.get("healthcare", "") in EXCLUDE_HEALTHCARE:
        return True
    sf_for = tags.get("social_facility:for", "").lower()
    if any(v in sf_for for v in EXCLUDE_SOCIAL_FOR):
        return True
    if "genetic counsel" in blob:  # genetic counseling is a wanted medical service
        return False
    return any(kw in blob for kw in EXCLUDE_KEYWORDS)

# OSM tag -> site category slug. Checked in order; first match wins.
_OSM_RULES = [
    ("office", "therapist", "therapy"),
    ("healthcare", "rehabilitation", "therapy"),
    ("healthcare", "physiotherapist", "therapy"),
    ("healthcare", "occupational_therapist", "therapy"),
    ("healthcare", "speech_therapist", "therapy"),
    ("healthcare", "therapist", "therapy"),
    ("shop", "mobility", "equipment"),
    ("shop", "medical_supply", "equipment"),
    ("healthcare", "hospital", "medical"),
    ("healthcare", "clinic", "medical"),
    ("healthcare", "centre", "medical"),
    ("amenity", "clinic", "medical"),
    ("amenity", "social_centre", "community"),
    ("office", "charity", "nonprofit"),
]

# social_facility:for value -> slug (disability-relevant subset)
_SOCIAL_FOR = {
    "disabled": "community",
    "mental_health": None,   # mental-health is out of scope for scraping
    "autism": "community",
    "senior": None,   # not disability-relevant on its own
    "child": None,
}

# social_facility value -> slug
_SOCIAL_FACILITY = {
    "group_home": "housing",
    "assisted_living": "housing",
    "nursing_home": "housing",
    "day_care": "community",
    "outreach": "community",
    "workshop": "employment",
    "ambulatory_care": "medical",
    "healthcare": "medical",
}


def osm_category(tags):
    """Map an OSM element's tags to a site category slug, or None if unmappable."""
    sf_for = tags.get("social_facility:for", "")
    for token in sf_for.replace(";", " ").split():
        if token in _SOCIAL_FOR and _SOCIAL_FOR[token]:
            return _SOCIAL_FOR[token]
    sf = tags.get("social_facility", "")
    if sf in _SOCIAL_FACILITY:
        return _SOCIAL_FACILITY[sf]
    for key, value, slug in _OSM_RULES:
        if tags.get(key) == value:
            return slug
    return None


def is_disability_relevant(text, tags=None):
    """True if the text (name + description) or tags indicate a disability/
    caregiver resource. tags is an optional dict of OSM/source tags."""
    blob = (text or "").lower()
    tags = tags or {}
    # A disability-specific structured tag is sufficient on its own.
    sf_for = tags.get("social_facility:for", "").lower()
    if any(v in sf_for for v in ("disabled", "autism")):
        return True
    healthcare = tags.get("healthcare", "")
    if healthcare in ("rehabilitation", "physiotherapist", "occupational_therapist",
                      "speech_therapist"):
        return True
    if tags.get("office") == "therapist" or tags.get("shop") in ("mobility", "medical_supply"):
        return True
    # Otherwise require a keyword and no overriding noise signal.
    if any(kw in blob for kw in RELEVANCE_KEYWORDS):
        return True
    return False


def is_noise(text):
    """True if the text looks like a non-disability (e.g. senior-only) row and
    carries no relevance keyword."""
    blob = (text or "").lower()
    if any(kw in blob for kw in RELEVANCE_KEYWORDS):
        return False
    return any(kw in blob for kw in NOISE_KEYWORDS)


def safe_category(slug):
    """Return slug if it's a real site category, else 'other'."""
    return slug if slug in SITE_CATEGORIES else "other"
