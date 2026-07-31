# tfp-admin-api Worker

Backend for the admin review portal at `/admin/review/` and the public
resource-submission and newsletter intake. Companion to the gig-publisher
worker in `../cloudflare-worker/`.

## Routes

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /submit` | public | Resource form intake → `pending/submissions.json` + Formspree forward + Brevo thank-you (new emails only) |
| `POST /newsletter` | public | Newsletter signup → Brevo double-opt-in + Formspree forward |
| `GET /pending` | admin | All pending envelopes across `pending/` |
| `POST /approve` | admin | `{items:[{id, file, payload?}]}` or `{all:true, type?}` — moves payloads into live data in ONE atomic commit |
| `POST /reject` | admin | `{items:[{id, file}], block?:true}` — removes envelopes; blocklists scraper-origin items |
| `POST /bulk-import` | admin | `{items:[resource fields], detail?, publish?:false}` — queue (default) or direct-publish |
| `GET /emails` | admin | Brevo contacts proxy (read-only; API key never reaches the browser) |
| `GET /health` | public | `{status: "ok"}` |

Admin auth: `Authorization: token <github-oauth-token>` (or `Bearer`) — the
worker verifies the token's account has **push permission** on the repo.
`X-Admin-Key: <ADMIN_KEY>` works as a break-glass alternative for curl.

## Approval semantics

| Type | On approve |
|------|-----------|
| resource / submission | Append to `targetFile` (state file via location map) + stamp `dateAdded` + `origin`; skip if already live |
| story | Prepend to `stories.json`, `addedDate`, sort by date desc, cap 6 |
| spotlight | Prepend + `approvedAt`; exactly one featured (the newest approved) |
| blog | Create `src/blog/<slug>.md` (template ported from `blog_content.py` — keep in sync); 409 if slug exists |

On reject (default `block: true`): scraper-origin items get their URL/name
appended to `scrapers/blocklist.json` so they can never re-queue.

All writes go through the git data API as a single atomic commit. On a
concurrent-commit conflict the worker re-reads every touched file, re-applies
the mutations, and retries (×3) — safe against the weekly scrape commit and
second admins. Commits to `main` auto-deploy via the existing Pages workflow.

## Deploy

```bash
cd cloudflare-worker-admin-api
npx wrangler deploy
# then set each secret:
npx wrangler secret put GITHUB_TOKEN     # same PAT as the gig worker
npx wrangler secret put GITHUB_REPO      # The-Fullest-Project/thefullestproject
npx wrangler secret put ALLOWED_ORIGIN   # https://thefullestproject.org
npx wrangler secret put ADMIN_KEY
npx wrangler secret put FORMSPREE_SUBMIT_ID      # xpqywwla
npx wrangler secret put FORMSPREE_NEWSLETTER_ID  # meeroozw
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put BREVO_LIST_ID
npx wrangler secret put BREVO_THANKYOU_TEMPLATE_ID
npx wrangler secret put BREVO_DOI_TEMPLATE_ID
npx wrangler secret put BREVO_APPROVED_TEMPLATE_ID   # approval thank-you (optional)
```

Brevo features no-op gracefully until the `BREVO_*` secrets are set, so the
worker can ship before the Brevo account exists.

## Edit Studio (inline page editing) — activation

`/admin/edit/` lets an admin change text by clicking it on the real page. The
code is committed but **inert until two things happen**:

```bash
# 1. A signing secret for the short-lived edit-session tokens.
#    Must be at least 32 characters — the worker fails closed below that.
npx wrangler secret put EDIT_SESSION_SECRET   # e.g. openssl rand -base64 48

# 2. Deploy.
npx wrangler deploy
```

Until then `/inline-edit/*` returns `500 {"error":"Editing is not configured"}`
and the rest of the worker is unaffected.

**Turning it off.** Set `inlineEditor.enabled` to `false` in
`src/_data/site.json` and push. That governs both halves: Eleventy stops copying
`src/admin-edit/` into the build, so `/admin/edit/` 404s, and the API returns
404 for every `/inline-edit/*` request. For an immediate kill with no deploy,
set the Cloudflare environment variable `INLINE_EDIT_ENABLED=0`.

**Revoking sessions.** Rotate `EDIT_SESSION_SECRET`. Every outstanding session
dies on its next request — no deploy, no rebuild.

**What a session can do.** Replace an existing non-empty text string at an
allow-listed `(block type, field path)` on the homepage, About or Get Involved,
for two hours. It cannot change URLs, section order, visibility, backgrounds, or
add or delete anything, and it grants nothing on GitHub. Every change is one
commit naming the actor, revertible with `git revert`.

The allow-list is `editable-fields.js`, shared with the test suite so the two
cannot drift:

```bash
node cloudflare-worker-admin-api/test-inline-edit.mjs
```

Two of those tests compare the table against the `data-block-field` anchors in
`src/_includes/components/blocks/*.njk` in both directions, so adding an anchor
without a rule (or a rule without an anchor) fails.

## Approval thank-you email

When an admin approves a **submission** (a resource sent through the site form or
Quick Submit bookmarklet), the worker emails that submitter a thank-you letting
them know it's live. Two things activate it (both no-op until set):

1. **`SUBMITTER_EMAILS` KV namespace** — emails never enter the public repo, so
   the worker stores `pending submission id → email` privately in KV at submit
   time and looks it up at approval, then deletes it. Create and bind it:

   ```bash
   npx wrangler kv namespace create SUBMITTER_EMAILS
   # paste the printed id into wrangler.toml (uncomment the [[kv_namespaces]] block)
   npx wrangler deploy
   ```

2. **`BREVO_APPROVED_TEMPLATE_ID`** — a Brevo transactional template. Suggested
   copy (subject + body), using the `{{ params.RESOURCE_NAME }}` variable the
   worker passes:

   > **Subject:** Your resource is now on The Fullest Project 💛
   >
   > Thank you for submitting **{{ params.RESOURCE_NAME }}**! Our team reviewed
   > it and it's now live in the directory for other caregivers and families to
   > find. Sharing what you know helps our whole community — thank you for
   > building this with us.
   >
   > Know another resource? Add it anytime at thefullestproject.org/submit-resource/

Only `submission`-type items trigger this (scraped resources have no submitter).
Approvals still succeed if the email send fails — it's best-effort and off the
response path.

## Local testing

```bash
npx wrangler dev
# .dev.vars file (gitignored) holds the env vars; point GITHUB_REPO at a fork.
curl -X POST http://localhost:8787/submit -d "resourceName=Test&location=Virginia&category=therapy&description=Test"
curl http://localhost:8787/pending -H "X-Admin-Key: <key>"
```
