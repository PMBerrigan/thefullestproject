// Inline-editor field allow-list and path resolution. Kept in its own module so
// the Node test suite imports exactly the same table the worker enforces.
import {
  EDITABLE_PAGES, CMS_ENTRY, REASON_TEXT,
  resolveLeaf, cleanValue, enumerateFields, blockLabel
} from "./editable-fields.js";

/**
 * Cloudflare Worker: tfp-admin-api
 *
 * Backend for the admin review portal (/admin/review/) and the public
 * resource-submission / newsletter intake.
 *
 * Public routes:
 *   POST /submit      — resource form intake → pending/submissions.json
 *                       (+ Formspree notification forward + Brevo thank-you)
 *   POST /newsletter  — newsletter signup → Brevo double-opt-in
 *
 * Admin routes (GitHub OAuth token with push permission, or X-Admin-Key):
 *   GET  /pending     — every pending envelope across the store
 *   POST /approve     — {items:[{id, file, payload?}]} or {all:true, type?}
 *                       (+ Brevo approval thank-you to the submitter)
 *   POST /reject      — {items:[{id, file}], block?:true}
 *   POST /bulk-import — {items:[resource fields], detail?, publish?:false}
 *   GET  /emails      — Brevo contacts proxy (read-only)
 *
 * Environment (Cloudflare dashboard):
 *   GITHUB_TOKEN              — PAT with repo scope (worker's own commits)
 *   GITHUB_REPO               — "The-Fullest-Project/thefullestproject"
 *   ALLOWED_ORIGIN            — "https://thefullestproject.org"
 *   ADMIN_KEY                 — break-glass admin header for curl use
 *   FORMSPREE_SUBMIT_ID       — xpqywwla (resource submissions)
 *   FORMSPREE_NEWSLETTER_ID   — meeroozw (newsletter signups)
 *   BREVO_API_KEY             — Brevo v3 API key (email features no-op if unset)
 *   BREVO_LIST_ID             — numeric id of the "TFP Community" list
 *   BREVO_THANKYOU_TEMPLATE_ID — transactional template for submitter thank-you
 *   BREVO_DOI_TEMPLATE_ID     — double-opt-in confirmation template
 *   BREVO_APPROVED_TEMPLATE_ID — transactional template emailed to a submitter
 *                                when their submission is approved (no-op if unset)
 *
 * KV namespaces (wrangler.toml):
 *   SUBMITTER_EMAILS          — private pendingId → submitter email map so the
 *                               approval thank-you can reach the submitter; the
 *                               public repo never stores emails. No-op if unbound.
 */

const SUBMISSIONS_PATH = "pending/submissions.json";
const NEWSLETTER_DRAFTS_PATH = "pending/newsletter-drafts.json";
const SCRAPED_DIR = "pending/scraped";
const BLOCKLIST_PATH = "scrapers/blocklist.json";
const STORIES_PATH = "src/_data/stories.json";
const SPOTLIGHTS_PATH = "src/_data/spotlights.json";
const MAX_STORIES = 6; // mirrors scrapers/sources/positive_stories.py
const MAX_CHANGED_FILES = 40; // stay well under the 50-subrequest cap

const STATE_CODES = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
  "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
  "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI",
  "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
  "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME",
  "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
  "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE",
  "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
  "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
  "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
  "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return cors(env, new Response(null, { status: 204 }));
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

    try {
      if (request.method === "POST" && path === "/submit") {
        return cors(env, await handleSubmit(request, env, ctx));
      }
      if (request.method === "POST" && path === "/newsletter") {
        return cors(env, await handleNewsletter(request, env, ctx));
      }
      if (path === "/health") {
        return cors(env, json({ status: "ok" }));
      }

      // Inline page editing. Handled before requireAdmin because every route
      // but /session authenticates with a short-lived capability token rather
      // than a GitHub token — the editing tab never holds a repo credential.
      if (path.startsWith("/inline-edit")) {
        if (env.INLINE_EDIT_ENABLED === "0") {
          return cors(env, json({ error: "Not found" }, 404));
        }
        if (!(await inlineEditEnabled(env))) {
          return cors(env, json({ error: "Inline editing is turned off" }, 404));
        }
        const allowed = (env.ALLOWED_ORIGIN || "https://thefullestproject.org")
          .split(",").map(s => s.trim()).filter(Boolean);
        if (!allowed.includes(request.headers.get("Origin") || "")) {
          return cors(env, json({ error: "Bad origin" }, 403));
        }

        if (request.method === "POST" && path === "/inline-edit/session") {
          const a = await requireAdmin(request, env);
          if (a.error) return cors(env, json({ error: a.message }, a.error));
          return cors(env, await handleEditSession(env, a));
        }

        const sess = await requireEditSession(request, env);
        if (sess.error) return cors(env, json({ error: sess.message }, sess.error));

        if (request.method === "GET" && path === "/inline-edit/page") {
          return cors(env, await handleInlinePage(new URL(request.url), env));
        }
        if (request.method === "POST" && path === "/inline-edit/save") {
          return cors(env, await handleInlineSave(await request.json(), env, sess));
        }
        return cors(env, json({ error: "Not found" }, 404));
      }

      // Everything else is admin-only
      const auth = await requireAdmin(request, env);
      if (auth.error) {
        return cors(env, json({ error: auth.message }, auth.error));
      }

      if (request.method === "GET" && path === "/pending") {
        return cors(env, await handlePending(env));
      }
      if (request.method === "POST" && path === "/approve") {
        return cors(env, await handleApprove(await request.json(), env, auth, ctx));
      }
      if (request.method === "POST" && path === "/reject") {
        return cors(env, await handleReject(await request.json(), env, auth));
      }
      if (request.method === "POST" && path === "/bulk-import") {
        return cors(env, await handleBulkImport(await request.json(), env, auth));
      }
      if (request.method === "GET" && path === "/emails") {
        return cors(env, await handleEmails(new URL(request.url), env));
      }
      if (request.method === "GET" && path === "/newsletter-drafts") {
        return cors(env, await handleNewsletterDraftsGet(env));
      }
      if (request.method === "POST" && path === "/newsletter-drafts") {
        return cors(env, await handleNewsletterDraftsPost(await request.json(), env, auth));
      }
      if (request.method === "POST" && path === "/draft-description") {
        return cors(env, await handleDraftDescription(await request.json(), env));
      }

      return cors(env, json({ error: "Not found" }, 404));
    } catch (err) {
      return cors(env, json({ error: "Internal error", detail: err.message }, 500));
    }
  }
};

// ─── Auth ────────────────────────────────────────────────────────────────────

async function requireAdmin(request, env) {
  const adminKey = request.headers.get("X-Admin-Key");
  if (adminKey && env.ADMIN_KEY && adminKey === env.ADMIN_KEY) {
    return { ok: true, actor: "admin-key" };
  }

  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^(token|bearer)\s+/i, "").trim();
  if (!token) {
    return { error: 401, message: "Missing Authorization header" };
  }

  // The repo is public, so reads succeed for anyone — the actual gate is
  // push permission, which GitHub only reports for the authenticated user.
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "tfp-admin-api"
    }
  });
  if (res.status === 401) {
    return { error: 401, message: "Invalid or expired GitHub token" };
  }
  if (!res.ok) {
    return { error: 403, message: "Could not verify repository access" };
  }
  const repo = await res.json();
  if (!repo.permissions || !repo.permissions.push) {
    return { error: 403, message: "Your GitHub account does not have push access to the site repository" };
  }

  // Best-effort actor name for commit messages
  let actor = "github-admin";
  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "tfp-admin-api" }
    });
    if (userRes.ok) actor = (await userRes.json()).login || actor;
  } catch { /* non-fatal */ }

  return { ok: true, actor };
}

// ─── Public: resource submission ─────────────────────────────────────────────

async function handleSubmit(request, env, ctx) {
  const formData = await request.formData();
  const data = Object.fromEntries(formData.entries());

  const required = ["resourceName", "location", "category", "description"];
  const missing = required.filter(f => !data[f]?.trim());
  if (missing.length > 0) {
    return json({ error: `Missing required fields: ${missing.join(", ")}` }, 400);
  }

  const today = new Date().toISOString().split("T")[0];
  const isBookmarklet = data.submissionSource === "quick-submit";
  // Tags arrive comma-separated from the form's tag widget.
  const tags = (data.tags || "").split(",").map(t => t.trim()).filter(Boolean).slice(0, 20);
  // PII rule: submitterEmail / submitterName never enter the envelope (public repo).
  const payload = {
    name: data.resourceName.trim().slice(0, 200),
    category: [data.category.trim()],
    location: data.location.trim(),
    area: (data.area || "").trim(),
    description: data.description.trim(),
    phone: (data.resourcePhone || data.contactInfo || "").trim(),
    email: (data.resourceEmail || "").trim(),
    website: (data.website || "").trim(),
    address: (data.resourceAddress || "").trim(),
    ageRange: "",
    disabilityTypes: [],
    cost: "",
    tags: tags,
    source: (data.website || "").trim() || "website-submission",
    lastScraped: today
  };

  const envelope = {
    id: await pendingId("sub", `submission|${payload.name}|${payload.location}`),
    type: "submission",
    status: "pending",
    origin: {
      type: isBookmarklet ? "quick-submit" : "submission",
      detail: isBookmarklet ? "bookmarklet" : "submit-resource-form",
      submittedAt: new Date().toISOString()
    },
    targetFile: resourceTargetFile(payload.location),
    payload
  };

  const err = await appendSubmission(envelope, env);
  if (err) return err;

  // Formspree notification forward (carries submitterEmail) — fire and forget
  if (env.FORMSPREE_SUBMIT_ID) {
    const body = new FormData();
    for (const [k, v] of Object.entries(data)) body.append(k, v);
    body.append("_pendingId", envelope.id);
    ctx.waitUntil(fetch(`https://formspree.io/f/${env.FORMSPREE_SUBMIT_ID}`, {
      method: "POST", body, headers: { Accept: "application/json" }
    }).catch(() => {}));
  }

  // Brevo: thank a NEW submitter and invite them to the list — never blocks
  const email = (data.submitterEmail || "").trim();
  if (email) {
    ctx.waitUntil(brevoThankSubmitter(email, env).catch(() => {}));
    // Privately remember who submitted (off-repo, in KV) so an admin approval
    // can email them a thank-you. The public repo never stores emails.
    if (env.SUBMITTER_EMAILS) {
      ctx.waitUntil(env.SUBMITTER_EMAILS.put(envelope.id, email, { expirationTtl: 120 * 86400 }).catch(() => {}));
    }
  }

  return json({
    success: true,
    pendingId: envelope.id,
    message: "Thank you! Your resource has been submitted for review and will appear on the site once approved."
  }, 201);
}

async function appendSubmission(envelope, env) {
  // Contents-API read-modify-write with SHA-conflict retry
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = await readRepoFile(env, SUBMISSIONS_PATH);
    const submissions = file ? file.json : [];
    if (submissions.some(e => e.id === envelope.id)) {
      return null; // duplicate submission — treat as success
    }
    submissions.push(envelope);
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${SUBMISSIONS_PATH}`,
      {
        method: "PUT",
        headers: ghHeaders(env),
        body: JSON.stringify({
          message: `New resource submission: ${envelope.payload.name}`,
          content: b64encode(JSON.stringify(submissions, null, 2)),
          sha: file ? file.sha : undefined,
          committer: { name: "TFP Admin API", email: "worker@thefullestproject.org" }
        })
      }
    );
    if (res.ok) return null;
    if (res.status !== 409 && res.status !== 422) {
      return json({ error: "Failed to save submission", detail: await res.text() }, 502);
    }
    // stale SHA — loop and re-read
  }
  return json({ error: "Failed to save submission after retries" }, 502);
}

// ─── Public: newsletter ──────────────────────────────────────────────────────

async function handleNewsletter(request, env, ctx) {
  const formData = await request.formData();
  const email = (formData.get("email") || "").trim();
  if (!email || !email.includes("@")) {
    return json({ error: "A valid email address is required" }, 400);
  }

  if (env.FORMSPREE_NEWSLETTER_ID) {
    const body = new FormData();
    body.append("email", email);
    ctx.waitUntil(fetch(`https://formspree.io/f/${env.FORMSPREE_NEWSLETTER_ID}`, {
      method: "POST", body, headers: { Accept: "application/json" }
    }).catch(() => {}));
  }

  if (brevoConfigured(env)) {
    try {
      await brevoDoubleOptIn(email, "newsletter-form", env);
    } catch (err) {
      // Formspree still captured the signup; report success to the visitor
      console.log("Brevo DOI failed:", err.message);
    }
  }

  return json({
    success: true,
    message: "Almost there — check your inbox for a confirmation email."
  });
}

// ─── Admin: pending queue ────────────────────────────────────────────────────

async function handlePending(env) {
  const items = [];
  const counts = {};

  const dir = await listRepoDir(env, SCRAPED_DIR);
  const batchFiles = dir.filter(f => f.name.endsWith(".json"));
  for (const f of batchFiles) {
    const file = await readRepoFile(env, f.path);
    if (!file) continue;
    for (const envls of file.json) {
      items.push({ ...envls, file: f.path });
    }
  }

  const submissions = await readRepoFile(env, SUBMISSIONS_PATH);
  if (submissions) {
    for (const envls of submissions.json) {
      items.push({ ...envls, file: SUBMISSIONS_PATH });
    }
  }

  for (const item of items) {
    counts[item.type] = (counts[item.type] || 0) + 1;
  }

  return json({ items, counts });
}

// ─── Admin: approve ──────────────────────────────────────────────────────────

async function handleApprove(body, env, auth, ctx) {
  const selection = await resolveSelection(body, env);
  if (selection.error) return selection.error;
  const { byFile, overrides, newsletterFlags } = selection;

  const approved = [], failed = [];
  const approvedSubmissions = []; // {id, name} of approved user submissions — for the thank-you email
  const paragraphCache = new Map(); // id -> generated paragraph (survives commit retries)
  const result = await commitWithRetry(env, async () => {
    approved.length = 0; failed.length = 0; approvedSubmissions.length = 0;
    const changes = new Map(); // repo path -> content string | null (delete)
    const liveCache = new Map();

    const readLive = async (path, fallback) => {
      if (!liveCache.has(path)) {
        const file = await readRepoFile(env, path);
        liveCache.set(path, file ? file.json : fallback);
      }
      return liveCache.get(path);
    };

    const today = new Date().toISOString().split("T")[0];
    const approvedSpotlights = [];

    for (const [pendingPath, wanted] of byFile.entries()) {
      const pendingFile = await readRepoFile(env, pendingPath);
      const envelopes = pendingFile ? pendingFile.json : [];
      const remaining = [];

      for (const envl of envelopes) {
        if (!wanted.has(envl.id)) { remaining.push(envl); continue; }
        wanted.delete(envl.id);
        const payload = overrides.get(envl.id) || envl.payload;

        try {
          if (envl.type === "resource" || envl.type === "submission") {
            const target = envl.targetFile || resourceTargetFile(payload.location);
            const live = await readLive(target, []);
            if (live.some(r => r.name === payload.name && r.location === payload.location)) {
              failed.push({ id: envl.id, reason: "already-live" });
            } else {
              delete payload.submitterEmail; // defense in depth — repo is public
              live.push({ ...payload, dateAdded: today, origin: stripTimestamps(envl.origin) });
              changes.set(target, pretty(live));
              approved.push(envl.id);
              if (envl.type === "submission") approvedSubmissions.push({ id: envl.id, name: payload.name });

              // Flagged for the newsletter: copy into the drafts store with an
              // AI-drafted (or template) starter paragraph, same atomic commit.
              if (newsletterFlags && newsletterFlags.has(envl.id)) {
                const drafts = await readLive(NEWSLETTER_DRAFTS_PATH, []);
                if (!drafts.some(d => d.sourceId === envl.id)) {
                  if (!paragraphCache.has(envl.id)) {
                    paragraphCache.set(envl.id, await generateParagraph(payload, env));
                  }
                  drafts.push({
                    id: `nld-${today.replace(/-/g, "")}-${envl.id.slice(-8)}`,
                    sourceId: envl.id,
                    type: envl.type,
                    flaggedAt: new Date().toISOString(),
                    payload: { name: payload.name, category: payload.category,
                               location: payload.location, website: payload.website || "",
                               description: payload.description || "" },
                    paragraph: paragraphCache.get(envl.id)
                  });
                  changes.set(NEWSLETTER_DRAFTS_PATH, pretty(drafts));
                }
              }
            }
          } else if (envl.type === "story") {
            const stories = await readLive(STORIES_PATH, []);
            stories.unshift({ ...payload, addedDate: today });
            stories.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
            liveCache.set(STORIES_PATH, stories.slice(0, MAX_STORIES));
            changes.set(STORIES_PATH, pretty(liveCache.get(STORIES_PATH)));
            approved.push(envl.id);
          } else if (envl.type === "spotlight") {
            const spotlights = await readLive(SPOTLIGHTS_PATH, []);
            spotlights.unshift({ ...payload, approvedAt: today });
            approvedSpotlights.push(payload.name);
            spotlights.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
            changes.set(SPOTLIGHTS_PATH, pretty(spotlights));
            approved.push(envl.id);
          } else if (envl.type === "blog") {
            const mdPath = `src/blog/${payload.slug}.md`;
            const exists = await readRepoFile(env, mdPath);
            if (exists) {
              failed.push({ id: envl.id, reason: "slug-exists" });
            } else {
              changes.set(mdPath, renderBlogMarkdown(payload, today));
              approved.push(envl.id);
            }
          } else {
            failed.push({ id: envl.id, reason: `unknown type: ${envl.type}` });
          }
        } catch (err) {
          failed.push({ id: envl.id, reason: err.message });
          remaining.push(envl);
        }
      }

      for (const id of wanted) failed.push({ id, reason: "already-resolved" });
      writePendingChange(changes, pendingPath, remaining);
    }

    // Featured rotation: exactly one featured spotlight — the newest approved
    if (approvedSpotlights.length > 0 && liveCache.has(SPOTLIGHTS_PATH)) {
      const spotlights = liveCache.get(SPOTLIGHTS_PATH);
      let crowned = false;
      for (const s of spotlights) {
        if (!crowned && approvedSpotlights.includes(s.name)) {
          s.featured = true;
          crowned = true;
        } else {
          s.featured = false;
        }
      }
      changes.set(SPOTLIGHTS_PATH, pretty(spotlights));
    }

    return changes;
  }, () => `Approve ${approved.length} item(s) via admin portal (by ${auth.actor})`);

  if (result.error) return result.error;

  // Thank submitters whose items are now live (best-effort, off the response path)
  if (ctx && env.SUBMITTER_EMAILS && approvedSubmissions.length) {
    ctx.waitUntil(notifyApprovedSubmitters(approvedSubmissions, env));
  }

  return json({ approved, failed, commitSha: result.sha });
}

// ─── Admin: reject ───────────────────────────────────────────────────────────

async function handleReject(body, env, auth) {
  const selection = await resolveSelection(body, env);
  if (selection.error) return selection.error;
  const { byFile } = selection;
  const block = body.block !== false; // default: blocklist scraped items

  const rejected = [], blocked = [], failed = [];
  const result = await commitWithRetry(env, async () => {
    rejected.length = 0; blocked.length = 0; failed.length = 0;
    const changes = new Map();

    const blocklistFile = await readRepoFile(env, BLOCKLIST_PATH);
    const blocklist = blocklistFile ? blocklistFile.json : { urls: [], names: [] };
    let blocklistChanged = false;

    for (const [pendingPath, wanted] of byFile.entries()) {
      const pendingFile = await readRepoFile(env, pendingPath);
      const envelopes = pendingFile ? pendingFile.json : [];
      const remaining = [];

      for (const envl of envelopes) {
        if (!wanted.has(envl.id)) { remaining.push(envl); continue; }
        wanted.delete(envl.id);
        rejected.push(envl.id);

        if (block && envl.origin?.type === "scraper") {
          const p = envl.payload || {};
          const url = p.website || p.sourceUrl || p.url || "";
          const name = p.name || p.title || "";
          if (url && !blocklist.urls.includes(url)) {
            blocklist.urls.push(url); blocklistChanged = true;
          }
          if (name && !blocklist.names.includes(name)) {
            blocklist.names.push(name); blocklistChanged = true;
          }
          if (name) blocked.push(name);
        }
      }

      for (const id of wanted) failed.push({ id, reason: "already-resolved" });
      writePendingChange(changes, pendingPath, remaining);
    }

    if (blocklistChanged) changes.set(BLOCKLIST_PATH, pretty(blocklist));
    return changes;
  }, () => `Reject ${rejected.length} item(s) via admin portal (by ${auth.actor})`);

  if (result.error) return result.error;
  return json({ rejected, blocked, failed, commitSha: result.sha });
}

// ─── Admin: bulk import ──────────────────────────────────────────────────────

async function handleBulkImport(body, env, auth) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return json({ error: "items array is required" }, 400);
  }
  if (items.length > 200) {
    return json({ error: "Maximum 200 items per import — split the file" }, 400);
  }

  const detail = (body.detail || "admin-portal").slice(0, 100);
  const today = new Date().toISOString().split("T")[0];
  const errors = [];
  const envelopes = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.name?.trim() || !item.location?.trim() || !item.category || !item.description?.trim()) {
      errors.push({ row: i + 1, reason: "name, location, category, and description are required" });
      continue;
    }
    const payload = {
      name: item.name.trim().slice(0, 200),
      category: Array.isArray(item.category) ? item.category : [String(item.category).trim()],
      location: item.location.trim(),
      area: (item.area || "").trim(),
      description: item.description.trim(),
      phone: (item.phone || "").trim(),
      website: (item.website || "").trim(),
      address: (item.address || "").trim(),
      ageRange: (item.ageRange || "").trim(),
      disabilityTypes: Array.isArray(item.disabilityTypes) ? item.disabilityTypes : [],
      cost: (item.cost || "").trim(),
      tags: Array.isArray(item.tags) ? item.tags : [],
      source: (item.website || "").trim() || `bulk-import:${detail}`,
      lastScraped: today
    };
    envelopes.push({
      id: await pendingId("sub", `bulk|${payload.name}|${payload.location}|${i}`),
      type: "submission",
      status: "pending",
      origin: { type: "bulk-import", detail, submittedAt: new Date().toISOString() },
      targetFile: resourceTargetFile(payload.location),
      payload
    });
  }

  if (envelopes.length === 0) {
    return json({ accepted: 0, errors }, 400);
  }

  if (body.publish === true) {
    // Direct publish: append straight to live target files in one commit
    const published = [];
    const result = await commitWithRetry(env, async () => {
      published.length = 0;
      const changes = new Map();
      const liveCache = new Map();
      for (const envl of envelopes) {
        const target = envl.targetFile;
        if (!liveCache.has(target)) {
          const file = await readRepoFile(env, target);
          liveCache.set(target, file ? file.json : []);
        }
        const live = liveCache.get(target);
        if (live.some(r => r.name === envl.payload.name && r.location === envl.payload.location)) {
          errors.push({ row: envl.payload.name, reason: "already-live" });
          continue;
        }
        live.push({ ...envl.payload, dateAdded: new Date().toISOString().split("T")[0], origin: stripTimestamps(envl.origin) });
        changes.set(target, pretty(live));
        published.push(envl.payload.name);
      }
      return changes;
    }, () => `Bulk import: publish ${published.length} resource(s) via admin portal (by ${auth.actor})`);
    if (result.error) return result.error;
    return json({ published: published.length, errors, commitSha: result.sha });
  }

  // Default: queue for review like any other submission
  for (const envl of envelopes) {
    const err = await appendSubmission(envl, env);
    if (err) return err;
  }
  return json({ queued: envelopes.map(e => e.id), accepted: envelopes.length, errors });
}

// ─── Admin: Brevo contacts proxy ─────────────────────────────────────────────

async function handleEmails(url, env) {
  if (!brevoConfigured(env)) {
    return json({ total: 0, contacts: [], note: "Brevo is not configured yet" });
  }
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const res = await fetch(
    `https://api.brevo.com/v3/contacts?limit=${limit}&offset=${offset}&sort=desc`,
    { headers: { "api-key": env.BREVO_API_KEY, Accept: "application/json" } }
  );
  if (!res.ok) {
    return json({ error: "Brevo request failed", detail: await res.text() }, 502);
  }
  const data = await res.json();
  const listId = parseInt(env.BREVO_LIST_ID || "0", 10);
  const contacts = (data.contacts || []).map(c => ({
    email: c.email,
    dateAdded: c.attributes?.DATE_ADDED || (c.createdAt || "").split("T")[0],
    source: c.attributes?.SOURCE || "",
    optIn: c.emailBlacklisted ? "unsubscribed"
      : (c.listIds || []).includes(listId) ? "confirmed"
      : c.attributes?.OPT_IN_STATUS || "unknown"
  }));
  return json({ total: data.count || contacts.length, contacts });
}

// ─── Admin: newsletter drafts ────────────────────────────────────────────────

async function handleNewsletterDraftsGet(env) {
  const file = await readRepoFile(env, NEWSLETTER_DRAFTS_PATH);
  return json({ drafts: file ? file.json : [] });
}

/** POST {id, paragraph} updates a draft's paragraph; {id, remove:true} deletes it. */
async function handleNewsletterDraftsPost(body, env, auth) {
  const id = (body.id || "").trim();
  if (!id) return json({ error: "id is required" }, 400);

  let found = false;
  const result = await commitWithRetry(env, async () => {
    const changes = new Map();
    const file = await readRepoFile(env, NEWSLETTER_DRAFTS_PATH);
    const drafts = file ? file.json : [];
    const idx = drafts.findIndex(d => d.id === id);
    found = idx !== -1;
    if (!found) return changes; // empty = nothing to commit

    if (body.remove === true) {
      drafts.splice(idx, 1);
    } else {
      drafts[idx].paragraph = String(body.paragraph || "").slice(0, 4000);
      drafts[idx].editedAt = new Date().toISOString();
    }
    changes.set(NEWSLETTER_DRAFTS_PATH, pretty(drafts));
    return changes;
  }, () => `${body.remove ? "Remove" : "Edit"} newsletter draft via admin portal (by ${auth.actor})`);

  if (result.error) return result.error;
  if (!found) return json({ error: "Draft not found" }, 404);
  return json({ success: true, commitSha: result.sha });
}

/** Draft a directory description for a resource under review. If the resource
 *  has a website we fetch it and mine its own meta/JSON-LD description for
 *  factual grounding, then have Claude Haiku write 1-2 plain sentences. The
 *  prompt forbids inventing specifics not present in the source material. */
async function handleDraftDescription(body, env) {
  const name = (body.name || "").trim();
  if (!name) return json({ error: "name is required" }, 400);
  const category = Array.isArray(body.category) ? body.category.join(", ") : (body.category || "");
  const location = (body.location || "").trim();
  const area = (body.area || "").trim();
  const website = (body.website || "").trim();

  const siteDescription = await fetchSiteDescription(website);

  if (!env.ANTHROPIC_API_KEY) {
    return json({ description: "", note: "AI drafting needs the ANTHROPIC_API_KEY worker secret." }, 200);
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Write a 1-2 sentence directory description of this resource for caregivers of individuals with disabilities. Plain language, factual, no marketing fluff. CRITICAL: only state things supported by the information below — do not invent services, specialties, or claims. If the information is thin, keep it short and general rather than making things up.\n\nName: ${name}\nCategory: ${category}\nLocation: ${[area, location].filter(Boolean).join(", ")}\nWebsite: ${website || "(none)"}\nThe organization's own description: ${siteDescription ? siteDescription.slice(0, 1000) : "(not available)"}`
        }]
      })
    });
    if (!res.ok) return json({ error: `AI request failed (${res.status})` }, 502);
    const data = await res.json();
    const text = (data.content && data.content[0] && data.content[0].text || "").trim();
    return json({ description: text, grounded: Boolean(siteDescription) });
  } catch (err) {
    return json({ error: "AI request failed: " + err.message }, 502);
  }
}

/** Free grounding pass for description drafting: fetch the org's site and
 *  mine its own og:/meta/JSON-LD description. Returns "" on any failure. */
async function fetchSiteDescription(website) {
  if (!/^https?:\/\//.test(website || "")) return "";
  try {
    const res = await fetch(website, {
      headers: { "User-Agent": "TheFullestProjectBot/1.0 (+https://thefullestproject.org/about/)" },
      signal: AbortSignal.timeout(10000)
    });
    const html = (await res.text()).slice(0, 400000);
    const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)
      || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (og) return og[1];
    for (const block of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const data = JSON.parse(block[1]);
        const nodes = Array.isArray(data) ? data : (data["@graph"] || [data]);
        const hit = nodes.find(n => n && n.description);
        if (hit) return String(hit.description);
      } catch { /* keep looking */ }
    }
  } catch { /* site unreachable/bot-walled — caller drafts from fields alone */ }
  return "";
}

/** Starter paragraph for a newsletter-flagged resource: what it is, when to use
 *  it, why it's interesting. Claude Haiku when ANTHROPIC_API_KEY is set; a
 *  serviceable template otherwise. Never throws. */
async function generateParagraph(payload, env) {
  const template = () => {
    const cat = (Array.isArray(payload.category) && payload.category[0]) || "disability services";
    const where = !payload.location || payload.location === "National" ? "nationwide" : `in ${payload.location}`;
    const desc = payload.description ? ` ${payload.description}` : "";
    return `${payload.name} offers ${cat.replace(/-/g, " ")} ${where}.${desc} Learn more at ${payload.website || "their website"}.`;
  };

  if (!env.ANTHROPIC_API_KEY) return template();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 250,
        messages: [{
          role: "user",
          content: `Write a warm, plain-language 2-3 sentence newsletter blurb for caregivers of individuals with disabilities about this resource. Cover: what it is, when a family might use it, and why it's worth knowing about. No headings, no markdown, no salesy tone.\n\nName: ${payload.name}\nCategory: ${(payload.category || []).join(", ")}\nLocation: ${payload.location || ""}\nDescription: ${payload.description || "(none provided)"}\nWebsite: ${payload.website || "(none)"}`
        }]
      })
    });
    if (!res.ok) return template();
    const data = await res.json();
    const text = data.content && data.content[0] && data.content[0].text;
    return (text || "").trim() || template();
  } catch {
    return template();
  }
}

// ─── Brevo helpers ───────────────────────────────────────────────────────────

function brevoConfigured(env) {
  return Boolean(env.BREVO_API_KEY && env.BREVO_LIST_ID);
}

function brevoHeaders(env) {
  return {
    "api-key": env.BREVO_API_KEY,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

async function brevoContactExists(email, env) {
  const res = await fetch(
    `https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`,
    { headers: brevoHeaders(env) }
  );
  return res.status === 200;
}

/** Thank-you for resource submitters: transactional email, sent ONLY when the
 *  email is new to us. Contact is stored as transactional_only — list
 *  membership requires the double-opt-in linked from the email's CTA. */
async function brevoThankSubmitter(email, env) {
  if (!brevoConfigured(env) || !env.BREVO_THANKYOU_TEMPLATE_ID) return;
  if (await brevoContactExists(email, env)) return; // not new — no email

  const today = new Date().toISOString().split("T")[0];
  await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: brevoHeaders(env),
    body: JSON.stringify({
      email,
      attributes: { SOURCE: "resource-submission", DATE_ADDED: today, OPT_IN_STATUS: "transactional_only" },
      updateEnabled: true
    })
  });
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: brevoHeaders(env),
    body: JSON.stringify({
      to: [{ email }],
      templateId: parseInt(env.BREVO_THANKYOU_TEMPLATE_ID, 10)
    })
  });
}

/** After an admin approves submissions, email each submitter a thank-you letting
 *  them know their resource is now live. Looks up the address in the private
 *  SUBMITTER_EMAILS KV map (populated at submit time), sends via a Brevo
 *  transactional template, then clears the mapping. No-ops if KV, Brevo, or the
 *  template id is unset. */
async function notifyApprovedSubmitters(items, env) {
  for (const it of items) {
    try {
      const email = await env.SUBMITTER_EMAILS.get(it.id);
      if (!email) continue;
      await brevoApprovalThankYou(email, it.name, env);
      await env.SUBMITTER_EMAILS.delete(it.id);
    } catch (err) {
      console.log("approval email failed for", it.id, err.message);
    }
  }
}

async function brevoApprovalThankYou(email, resourceName, env) {
  if (!brevoConfigured(env) || !env.BREVO_APPROVED_TEMPLATE_ID) return;
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: brevoHeaders(env),
    body: JSON.stringify({
      to: [{ email }],
      templateId: parseInt(env.BREVO_APPROVED_TEMPLATE_ID, 10),
      params: { RESOURCE_NAME: resourceName || "your resource" }
    })
  });
}

/** Newsletter signups: Brevo-native double-opt-in. The contact is only added
 *  to the list when they click the confirmation link Brevo sends. */
async function brevoDoubleOptIn(email, source, env) {
  if (!env.BREVO_DOI_TEMPLATE_ID) return;
  const today = new Date().toISOString().split("T")[0];
  const res = await fetch("https://api.brevo.com/v3/contacts/doubleOptinConfirmation", {
    method: "POST",
    headers: brevoHeaders(env),
    body: JSON.stringify({
      email,
      includeListIds: [parseInt(env.BREVO_LIST_ID, 10)],
      templateId: parseInt(env.BREVO_DOI_TEMPLATE_ID, 10),
      redirectionUrl: "https://thefullestproject.org/subscribed/",
      attributes: { SOURCE: source, DATE_ADDED: today, OPT_IN_STATUS: "pending_doi" }
    })
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Brevo DOI ${res.status}: ${await res.text()}`);
  }
}

// ─── Selection (shared by approve/reject) ────────────────────────────────────

/** Normalize {items:[{id, file, payload?, newsletterFlag?}]} or {all:true, type?}
 *  into a Map<pendingFilePath, Set<id>> plus per-id payload overrides and the
 *  set of ids flagged for the newsletter. */
async function resolveSelection(body, env) {
  const byFile = new Map();
  const overrides = new Map();
  const newsletterFlags = new Set();

  if (body.all === true) {
    const pendingRes = await handlePending(env);
    const { items } = await pendingRes.json();
    for (const item of items) {
      if (body.type && item.type !== body.type) continue;
      if (!byFile.has(item.file)) byFile.set(item.file, new Set());
      byFile.get(item.file).add(item.id);
    }
  } else {
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return { error: json({ error: "items array (or all:true) is required" }, 400) };
    }
    for (const item of items) {
      if (!item.id || !item.file || !item.file.startsWith("pending/")) {
        return { error: json({ error: `Each item needs id and a pending/ file path` }, 400) };
      }
      if (!byFile.has(item.file)) byFile.set(item.file, new Set());
      byFile.get(item.file).add(item.id);
      if (item.payload && typeof item.payload === "object") {
        overrides.set(item.id, item.payload);
      }
      if (item.newsletterFlag === true) {
        newsletterFlags.add(item.id);
      }
    }
  }

  if (byFile.size === 0) {
    return { error: json({ error: "Nothing selected" }, 400) };
  }
  return { byFile, overrides, newsletterFlags };
}

function writePendingChange(changes, pendingPath, remaining) {
  if (remaining.length === 0 && pendingPath !== SUBMISSIONS_PATH) {
    changes.set(pendingPath, null); // delete emptied scraped batch file
  } else {
    changes.set(pendingPath, pretty(remaining));
  }
}

function stripTimestamps(origin) {
  return { type: origin?.type || "unknown", detail: origin?.detail || "" };
}

// ─── Inline page editing ─────────────────────────────────────────────────────

const EDIT_SESSION_TTL = 7200;         // 2 hours
const MAX_INLINE_CHANGES = 25;
const INLINE_FLOOD_WINDOW_MS = 30_000; // one publish per half-minute
let inlineFlagCache = { at: 0, value: null };

/**
 * The feature flag lives in the repo (src/_data/site.json) so one edit turns
 * off BOTH halves: Eleventy stops copying the editor into _site, and this API
 * stops answering. Cached briefly because it costs a GitHub read.
 */
async function inlineEditEnabled(env) {
  const now = Date.now();
  if (inlineFlagCache.value !== null && now - inlineFlagCache.at < 60_000) {
    return inlineFlagCache.value;
  }
  let value = false;
  try {
    const file = await readRepoFile(env, "src/_data/site.json");
    value = !!(file && file.json && file.json.inlineEditor && file.json.inlineEditor.enabled === true);
  } catch {
    value = false; // fail closed
  }
  inlineFlagCache = { at: now, value };
  return value;
}

function editSecret(env) {
  const secret = env.EDIT_SESSION_SECRET;
  if (typeof secret !== "string" || secret.length < 32) return null;
  return secret;
}

function b64urlEncode(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

/**
 * Mint a capability token. Its entire vocabulary is "replace text at an
 * allow-listed field on one of three pages, for the next two hours" — it grants
 * nothing on GitHub. Revoke every outstanding session by rotating
 * EDIT_SESSION_SECRET in the Cloudflare dashboard; no deploy needed.
 */
async function mintEditSession(env, actor) {
  const secret = editSecret(env);
  if (!secret) return null;
  const iat = Math.floor(Date.now() / 1000);
  const payload = { v: 1, sub: actor, iat, exp: iat + EDIT_SESSION_TTL };
  const encoded = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(encoded));
  return { token: `tfpe_${encoded}.${b64urlEncode(new Uint8Array(sig))}`, expiresAt: payload.exp };
}

async function requireEditSession(request, env) {
  const secret = editSecret(env);
  if (!secret) return { error: 500, message: "Editing is not configured" };

  const raw = request.headers.get("X-Edit-Session") || "";
  if (!raw.startsWith("tfpe_")) return { error: 401, message: "Sign in to edit pages" };

  const [encoded, sig] = raw.slice(5).split(".");
  if (!encoded || !sig) return { error: 401, message: "Sign in to edit pages" };

  let valid = false;
  try {
    // Verify over the ENCODED payload, so there is no canonicalisation
    // ambiguity, and via subtle.verify rather than comparing base64 strings.
    valid = await crypto.subtle.verify(
      "HMAC", await hmacKey(secret), b64urlDecode(sig), new TextEncoder().encode(encoded)
    );
  } catch {
    valid = false;
  }
  if (!valid) return { error: 401, message: "Your editing session has expired — sign in again" };

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(encoded)));
  } catch {
    return { error: 401, message: "Your editing session has expired — sign in again" };
  }
  if (!payload || payload.v !== 1 || typeof payload.exp !== "number") {
    return { error: 401, message: "Your editing session has expired — sign in again" };
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { error: 401, message: "Your editing session has expired — sign in again" };
  }
  return { ok: true, actor: payload.sub || "unknown" };
}

async function handleEditSession(env, auth) {
  // An X-Admin-Key caller is not a named human, and every inline edit is
  // attributed by name in its commit message.
  if (auth.actor === "admin-key") {
    return json({ error: "Sign in with GitHub to edit pages." }, 403);
  }
  const minted = await mintEditSession(env, auth.actor);
  if (!minted) return json({ error: "Editing is not configured" }, 500);

  return json({
    session: minted.token,
    expiresAt: minted.expiresAt,
    actor: auth.actor,
    pages: { "/": "homepage", "/about/": "about", "/get-involved/": "getInvolved" }
  });
}

/**
 * The model. Every editable value the client is allowed to touch, read from
 * HEAD by the worker's own token — the browser never talks to api.github.com.
 * Because the client makes editable only what this enumerates, the client and
 * server allow-lists cannot drift: there is only one.
 */
async function handleInlinePage(url, env) {
  const page = url.searchParams.get("page") || "";
  const file = EDITABLE_PAGES[page];
  if (!file) return json({ error: "Unknown page" }, 400);

  const refRes = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/git/ref/heads/main`,
    { headers: ghHeaders(env) }
  );
  if (!refRes.ok) return json({ error: "Failed to read branch ref" }, 502);
  const headSha = (await refRes.json()).object.sha;

  const doc = await readRepoFile(env, file, headSha);
  if (!doc) return json({ error: "Page data not found" }, 404);

  const blocks = doc.json.blocks || [];
  return json({
    page,
    headSha,
    cmsEntry: CMS_ENTRY[page],
    fields: enumerateFields(blocks),
    blocks: blocks.map((b, i) => ({
      index: i, id: b.id || "", type: b.type,
      label: blockLabel(b, i), visible: b.visible !== false
    }))
  });
}

/**
 * Apply a batch of text changes as ONE commit.
 *
 * The client never sends a document — only a list of leaves with the value each
 * one is expected to currently hold. Every leaf is re-verified against a fresh
 * read pinned to the head being committed on, so a concurrent Decap edit to a
 * different field merges invisibly, while a concurrent edit to the SAME field
 * is reported honestly instead of clobbered.
 */
async function handleInlineSave(body, env, sess) {
  const file = EDITABLE_PAGES[body && body.page];
  if (!file) return json({ error: "Unknown page" }, 400);

  const requested = Array.isArray(body.changes) ? body.changes : null;
  if (!requested || requested.length === 0) {
    return json({ error: "No changes supplied" }, 400);
  }
  if (requested.length > MAX_INLINE_CHANGES) {
    return json({ error: `Too many changes at once (max ${MAX_INLINE_CHANGES})` }, 400);
  }
  for (const c of requested) {
    if (!Number.isInteger(c.blockIndex) || c.blockIndex < 0 || c.blockIndex >= 200) {
      return json({ error: "Bad section reference" }, 400);
    }
    if (c.blockId && (typeof c.blockId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(c.blockId))) {
      return json({ error: "Bad section reference" }, 400);
    }
    if (typeof c.field !== "string" || typeof c.value !== "string" || typeof c.expected !== "string") {
      return json({ error: "Bad change" }, 400);
    }
  }

  // Flood guard: one inline publish per 30s, so a burst cannot pile up in the
  // Pages deploy queue that the weekly scrape shares.
  const recent = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/commits?sha=main&per_page=1`,
    { headers: ghHeaders(env) }
  );
  if (recent.ok) {
    const [top] = await recent.json();
    const when = top && top.commit && top.commit.committer && Date.parse(top.commit.committer.date);
    if (top && /^Inline edit:/.test(top.commit.message || "") && when && Date.now() - when < INLINE_FLOOD_WINDOW_MS) {
      const wait = Math.ceil((INLINE_FLOOD_WINDOW_MS - (Date.now() - when)) / 1000);
      return json({ error: "Just a moment — the last change is still publishing.", retryAfterSeconds: wait }, 429);
    }
  }

  let applied = [];
  let conflicts = [];

  const result = await commitWithRetry(env, async (headSha) => {
    applied = [];
    conflicts = [];
    const changes = new Map();

    const current = await readRepoFile(env, file, headSha);
    if (!current) return changes;
    const doc = current.json;

    for (const c of requested) {
      const block = (doc.blocks || [])[c.blockIndex];
      if (!block) { conflicts.push({ ...c, reason: "section-moved" }); continue; }
      if (c.blockId && block.id && block.id !== c.blockId) {
        conflicts.push({ ...c, reason: "section-moved" }); continue;
      }
      const slot = resolveLeaf(block, block.type, c.field);
      if (slot.error) { conflicts.push({ ...c, reason: slot.error }); continue; }
      if (slot.current !== c.expected) {
        conflicts.push({ ...c, reason: "changed-elsewhere", current: slot.current }); continue;
      }
      const cleaned = cleanValue(c.value, slot.rule.max);
      if (cleaned.error) { conflicts.push({ ...c, reason: cleaned.error }); continue; }

      slot.parent[slot.key] = cleaned.value;
      applied.push({ blockIndex: c.blockIndex, field: c.field });
    }

    if (applied.length === 0) return changes;
    // Trailing newline matters: Decap writes one, and omitting it would produce
    // permanent one-line diff churn against the tool this must coexist with.
    changes.set(file, pretty(doc) + "\n");
    return changes;
  }, () => `Inline edit: ${body.page} — ${applied.map(a => `${a.blockIndex}.${a.field}`).join(", ")} (by ${sess.actor})`);

  if (result.error) return result.error;

  if (applied.length === 0) {
    return json({
      ok: false, commitSha: null, applied: [],
      conflicts: conflicts.map(withReasonText)
    }, 409);
  }
  return json({
    ok: true, commitSha: result.sha, applied,
    conflicts: conflicts.map(withReasonText)
  });
}

function withReasonText(c) {
  return {
    blockIndex: c.blockIndex, blockId: c.blockId || "", field: c.field,
    reason: c.reason, message: REASON_TEXT[c.reason] || "That change could not be saved.",
    ...(c.current !== undefined ? { current: c.current } : {})
  };
}

// ─── Git data API: one atomic commit, conflict-safe ──────────────────────────

/** buildChanges() re-reads every file it touches and returns
 *  Map<path, content|null>. On a concurrent-commit conflict the whole build
 *  is re-run against the new head, so mutations re-apply cleanly. */
async function commitWithRetry(env, buildChanges, message, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    // The ref and base tree are read BEFORE buildChanges so the sha can be
    // passed in and any file read pinned to it. Reading them afterwards left a
    // window where a blob fetched from the cache-backed /contents endpoint
    // belonged to an older commit than base_tree — the resulting commit is a
    // legal fast-forward, so the PATCH succeeds and someone else's edit to a
    // different field in the same file is silently reverted with no 409.
    const refRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/git/ref/heads/main`,
      { headers: ghHeaders(env) }
    );
    if (!refRes.ok) {
      return { error: json({ error: "Failed to read branch ref", detail: await refRes.text() }, 502) };
    }
    const headSha = (await refRes.json()).object.sha;

    const commitRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/git/commits/${headSha}`,
      { headers: ghHeaders(env) }
    );
    if (!commitRes.ok) {
      return { error: json({ error: "Failed to read head commit" }, 502) };
    }
    const baseTree = (await commitRes.json()).tree.sha;

    const changes = await buildChanges(headSha);
    if (changes.size === 0) {
      return { sha: null }; // nothing to commit (e.g. everything already-resolved)
    }
    if (changes.size > MAX_CHANGED_FILES) {
      return { error: json({ error: `Too many files in one batch (${changes.size} > ${MAX_CHANGED_FILES}) — split the selection` }, 400) };
    }

    const tree = [...changes.entries()].map(([path, content]) =>
      content === null
        ? { path, mode: "100644", type: "blob", sha: null }
        : { path, mode: "100644", type: "blob", content }
    );

    const treeRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/git/trees`,
      { method: "POST", headers: ghHeaders(env), body: JSON.stringify({ base_tree: baseTree, tree }) }
    );
    if (!treeRes.ok) {
      return { error: json({ error: "Failed to build git tree", detail: await treeRes.text() }, 502) };
    }
    const newTree = (await treeRes.json()).sha;

    const newCommitRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/git/commits`,
      {
        method: "POST", headers: ghHeaders(env),
        body: JSON.stringify({
          message: typeof message === "function" ? message() : message,
          tree: newTree,
          parents: [headSha],
          author: { name: "TFP Admin API", email: "worker@thefullestproject.org" }
        })
      }
    );
    if (!newCommitRes.ok) {
      return { error: json({ error: "Failed to create commit" }, 502) };
    }
    const newSha = (await newCommitRes.json()).sha;

    const patchRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/git/refs/heads/main`,
      { method: "PATCH", headers: ghHeaders(env), body: JSON.stringify({ sha: newSha }) }
    );
    if (patchRes.ok) {
      return { sha: newSha };
    }
    if (patchRes.status !== 422 && patchRes.status !== 409) {
      return { error: json({ error: "Failed to update branch", detail: await patchRes.text() }, 502) };
    }
    // Non-fast-forward: someone committed mid-flight. Loop — buildChanges()
    // re-reads everything against the new head and re-applies.
  }
  return { error: json({ error: "Could not commit after retries — the repository is busy, try again" }, 409) };
}

// ─── GitHub content helpers ──────────────────────────────────────────────────

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "tfp-admin-api",
    "Content-Type": "application/json"
  };
}

/**
 * Read a file from the repo. Pass `ref` (a commit sha) to pin the read — the
 * /contents endpoint is cache-backed, and an unpinned read can return a blob
 * from a different commit than the one the tree is built on. Existing callers
 * omit it and are unaffected.
 */
async function readRepoFile(env, path, ref) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}${query}`,
    { headers: ghHeaders(env) }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed for ${path}: ${res.status}`);
  const data = await res.json();
  const text = b64decode(data.content);
  return { json: JSON.parse(text), sha: data.sha, text };
}

async function listRepoDir(env, path) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`,
    { headers: ghHeaders(env) }
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list failed for ${path}: ${res.status}`);
  return (await res.json()).map(f => ({ name: f.name, path: f.path }));
}

// ─── Content rendering ───────────────────────────────────────────────────────

/** Canonical blog post generator — ported from scrapers/sources/blog_content.py
 *  create_blog_post(); keep the two in sync if the template changes. */
function renderBlogMarkdown(article, approvedAt) {
  const titleEscaped = article.title.replace(/"/g, '\\"');
  const categorySlug = article.category.toLowerCase().replace(/ /g, "-");
  return `---
layout: layouts/post.njk
title: "${titleEscaped}"
date: ${article.date}
author: "via ${article.source}"
category: "${article.category}"
excerpt: "Curated from ${article.source} — read the original article for the full story."
sourceUrl: "${article.url}"
autoGenerated: true
approvedAt: ${approvedAt}
tags:
  - curated
  - ${categorySlug}
---

*This article was curated from [${article.source}](${article.url}). Visit the original source for the full story.*

## ${article.title}

This article from ${article.source} covers topics relevant to the disability community, including ${article.category.toLowerCase()}. We've highlighted it here because we believe it offers valuable information for caregivers and families.

[Read the full article at ${article.source}](${article.url})

---

*Know of a great article or resource we should feature? [Submit it here](/submit-resource/) or use our [Quick Submit tool](/quick-submit/).*
`;
}

function resourceTargetFile(location) {
  if (!location || location === "National") return "src/_data/resources/national.json";
  // Region names route to their state file (regions live in the `area` field)
  if (location === "Northern Virginia") return "src/_data/resources/states/VA.json";
  if (location === "Portland" || location === "Portland, OR") return "src/_data/resources/states/OR.json";
  const code = STATE_CODES[location];
  return code ? `src/_data/resources/states/${code}.json` : "src/_data/resources/national.json";
}

// ─── Small utilities ─────────────────────────────────────────────────────────

async function pendingId(prefix, keyString) {
  const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const hash = Array.from(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyString))
  )).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 8);
  return `${prefix}-${today}-${hash}`;
}

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function b64decode(b64) {
  const bytes = Uint8Array.from(atob(b64.replace(/\n/g, "")), c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * ALLOWED_ORIGIN may be a comma-separated list (production plus, temporarily, a
 * localhost origin for manual smoke testing). Access-Control-Allow-Origin only
 * accepts ONE value, so echo the caller's origin when it is on the list and
 * fall back to the first entry otherwise.
 */
function cors(env, response, request) {
  const allowed = (env.ALLOWED_ORIGIN || "https://thefullestproject.org")
    .split(",").map(s => s.trim()).filter(Boolean);
  const requested = request && request.headers.get("Origin");
  const origin = requested && allowed.includes(requested) ? requested : allowed[0];

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key, X-Edit-Session");
  return new Response(response.body, { status: response.status, headers });
}
