# The Fullest Project

A connection hub for caregivers of individuals with disabilities to find national and local resources, programs, education, and community. The site serves two pilot locations (Northern Virginia and Portland, OR) plus national resources, with plans to expand. Built as a static site with an automated scraping pipeline to keep resource data current.

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Static Site Generator | Eleventy (11ty) | 3.x | Generates HTML from Nunjucks/Markdown templates |
| Templating | Nunjucks (.njk) | — | Page layouts, components, and data-driven rendering |
| Styling | Tailwind CSS | 4.x | Utility-first CSS with custom design tokens |
| Build Tool | @tailwindcss/cli | 4.x | Compiles Tailwind input CSS to output |
| Scraping | Python (scrapling, httpx) | 3.12 | Automated resource data collection |
| Forms | Formspree | — | Contact, resource submission, and newsletter forms (notification + fallback path) |
| Serverless | Cloudflare Workers | — | `gig-publisher` (gig auto-publish), `tfp-admin-api` (review portal backend + intake), `decap-oauth` (GitHub OAuth) |
| CMS | Decap CMS | 3.8.x | `/admin/` editing for blog, podcast, and Site Pages (home/about/blog copy via JSON file collections) |
| Email | Brevo | — | Email distribution database, double-opt-in newsletter, transactional submitter thank-yous |
| Deployment | GitHub Pages | — | Static site hosting via GitHub Actions deploy |
| CI/CD | GitHub Actions | — | Auto-deploy on push to main; weekly scrape job |

## Quick Start

```bash
# Prerequisites: Node.js 20+, npm

# Install dependencies
npm install

# Start development server (Eleventy + Tailwind watch)
npm run dev

# Build for production
npm run build

# Deploy (auto-deploys via GitHub Pages on push to main)
```

### Scraper Setup (optional)

```bash
# Prerequisites: Python 3.12+
pip install -r scrapers/requirements.txt

# Run all scrapers
python scrapers/run_all.py
```

## Project Structure

```
the-fullest-project/
├── src/                        # Eleventy source directory
│   ├── _data/                  # Global data files
│   │   ├── site.json           # Site metadata, locations, Formspree IDs
│   │   └── resources/          # Resource JSON files (nova, portland, national)
│   ├── _includes/
│   │   ├── layouts/            # Page layouts (base, page, post)
│   │   └── components/         # Reusable partials (nav, footer)
│   ├── pages/                  # Site pages (.njk)
│   │   ├── index.njk           # Homepage
│   │   ├── preview/            # Resource directory (folder name is legacy)
│   │   │   ├── index.njk       # /resources/ category hub
│   │   │   └── category.njk    # Paginated /resources/<category>/ pages
│   │   ├── apps.njk            # /resources/apps/ — dedicated Caregiver Apps page
│   │   ├── therapy-guide/      # Therapy types reference
│   │   ├── adaptive-equipment.njk
│   │   ├── school-iep/         # IEP/504 navigation guide
│   │   ├── services/           # Coaching and gig platform info
│   │   ├── gigs/               # Caregiver Gig Platform
│   │   │   ├── index.njk       # Filterable gig board
│   │   │   ├── post.njk        # Post a gig form
│   │   │   └── respond.njk     # Respond to a gig form
│   │   ├── blog.njk            # Blog listing
│   │   ├── podcast.njk         # Podcast listing
│   │   ├── about.njk           # Founder bios and mission
│   │   ├── contact.njk         # Contact form
│   │   └── submit-resource.njk # Community resource submission form
│   ├── blog/                   # Blog posts (Markdown with front matter)
│   ├── podcast/                # Podcast episodes (Markdown with front matter)
│   ├── css/
│   │   └── styles.css          # Tailwind input with custom theme and components
│   ├── js/
│   │   ├── main.js             # Mobile menu toggle
│   │   ├── categoryFilter.js   # Search/state/city/type filter for category pages
│   │   ├── appFilter.js        # Function/platform/price filter for the apps page
│   │   ├── gigFilter.js        # Client-side search/filter for gig board
│   │   └── gigRespond.js       # Gig response page URL param handler
│   ├── images/                 # Static images (passthrough copy)
│   ├── sitemap.njk             # XML sitemap generator
│   └── robots.njk              # robots.txt generator
├── scrapers/                   # Python scraping pipeline
│   ├── base_scraper.py         # Shared utilities (make_resource, save, merge)
│   ├── run_all.py              # Discovers and runs all scrapers in sources/
│   ├── requirements.txt        # Python deps (scrapling, httpx)
│   ├── sources/                # Individual scraper modules
│   │   ├── national_resources.py
│   │   ├── nova_resources.py
│   │   ├── example_arc.py      # Template scraper
│   │   └── process_gig.py      # Gig auto-publish, expire, extend, digest
│   └── output/                 # Raw scraper output (JSON)
├── _site/                      # Built output (gitignored)
├── .eleventy.js                # Eleventy configuration
├── .github/workflows/
│   ├── deploy.yml              # Build + deploy to GitHub Pages on push to main
│   ├── scrape.yml              # Weekly scrape → commit → build → deploy
│   └── gig-publish.yml         # Auto-publish gig from Formspree webhook
├── deploy.js                   # Legacy FTP deployment script (unused — deployment via GitHub Pages)
├── package.json                # Node.js dependencies and scripts
├── .env.example                # Legacy FTP credential template
└── .gitignore
```

## Architecture Overview

The site follows a **static-site-with-data-pipeline** architecture. Eleventy reads Nunjucks templates and Markdown content from `src/`, combines them with JSON resource data from `src/_data/resources/`, and generates a fully static HTML site in `_site/`. Tailwind CSS is compiled separately via `@tailwindcss/cli`.

Resource data flows through a two-stage pipeline: Python scrapers collect and normalize resource entries into a standard JSON schema, saving to both `scrapers/output/` (raw) and `src/_data/resources/` (consumed by Eleventy). The scraper pipeline runs weekly via GitHub Actions, commits updated data, then triggers a full build and deploy.

Client-side JavaScript is minimal and vanilla — a mobile nav toggle (`main.js`) plus filter/search scripts (`categoryFilter.js`, `appFilter.js`) that read `data-*` attributes from rendered cards. The retired `resourceFilter.js` and `resources.njk` were replaced by the category-hub redesign in `59de543`.

### Admin Review Pipeline

All NEW content is gated behind admin approval; only updates to already-live entries publish automatically:

- **Pending store** (repo-root `pending/`, deliberately outside `src/_data` so Eleventy never builds it): `pending/submissions.json` (written only by the worker) + `pending/scraped/<date>-<type>s.json` (created only by the weekly Action). Disjoint writers — no git conflicts. Envelope schema documented in `pending/README.md`.
- **Scraper gating** lives in `base_scraper.save_resources()` and `scrapers/pending_store.py` — the six resource source modules are untouched. `positive_stories.py`, `spotlight_scraper.py`, and `blog_content.py` queue instead of writing live; the blog `.md` is generated at approval time by the worker (`renderBlogMarkdown()` — keep in sync with `blog_content.create_blog_post()`).
- **Review portal** at `/admin/review/` (`src/admin/review/`, vanilla JS, no build step): GitHub OAuth via the decap-oauth worker popup (PAT paste fallback; `?mock=1` fixtures for localhost — the popup only completes on production). Tabs: Review Queue, Recently Added (weekly history + origin analytics from `/api/site-index.json`), Bulk Import (CSV via vendored PapaParse), Emails (Brevo contacts, read-only).
- **Worker** `cloudflare-worker-admin-api/` (deployed as `tfp-admin-api`): public `/submit` + `/newsletter` intake, admin `/pending` `/approve` `/reject` `/bulk-import` `/emails`. Admin auth = GitHub token with push permission on the repo. Approvals are ONE atomic git-tree commit with conflict re-apply retry; rejects blocklist scraper items in `scrapers/blocklist.json`. Worker commits to main auto-deploy via Pages.
- **Provenance**: every live resource carries `dateAdded` + `origin {type: scraper|submission|quick-submit|bulk-import, detail}` (legacy entries backfilled as `legacy-backfill` by `scripts/backfill-date-added.js`).
- **Email**: emails NEVER enter the public repo. Brevo holds the distribution list ("TFP Community", attributes SOURCE/DATE_ADDED/OPT_IN_STATUS). New submitter emails get a transactional thank-you; list membership only via Brevo double-opt-in (redirects to `/subscribed/`). Brevo calls no-op gracefully when secrets are unset.
- Unreviewed stories/spotlights/blog candidates auto-prune after 28 days (`pending_store.prune_stale`, run by the digest step); resources and human submissions never auto-prune.

### Key Modules

| Module | Location | Purpose |
|--------|----------|---------|
| Eleventy Config | `.eleventy.js` | Collections (blogPosts, podcastEpisodes), filters (dateFormat, limit, filterByCategory, filterByLocation), passthrough copies |
| Site Data | `src/_data/site.json` | Global metadata: site name, URL, email, locations array, Formspree form IDs |
| Resource Data | `src/_data/resources/*.json` | Resource entries keyed by location (nova, portland, national) |
| Base Scraper | `scrapers/base_scraper.py` | `make_resource()` factory, `save_resources()`, `load_existing()`, `merge_resources()` deduplication |
| Scraper Runner | `scrapers/run_all.py` | Auto-discovers and executes all `scrape()` functions in `scrapers/sources/` |
| Directory Data | `src/_data/directory.js` | Unifies every `resources/**/*.json` file; stamps `topCategories` and `facets` on each entry |
| Category Pages | `src/_data/categoryPages.js` | Categories the paginated `category.njk` should build — excludes slugs with dedicated templates |
| Category Filter | `src/js/categoryFilter.js` | Client-side search, state, city/region, and type-facet filtering with URL param support |
| App Filter | `src/js/appFilter.js` | Function, platform, and price filtering for `/resources/apps/` |

## Development Guidelines

### File Naming
- Page files: kebab-case (`adaptive-equipment.njk`, `submit-resource.njk`)
- Subdirectory pages use `index.njk` (e.g., `pages/school-iep/index.njk`)
- JS files: camelCase (`categoryFilter.js`, `appFilter.js`, `main.js`)
- Data files: kebab-case JSON (`nova.json`, `national.json`)
- Python files: snake_case (`base_scraper.py`, `run_all.py`, `nova_resources.py`)

### Code Naming
- JavaScript: camelCase variables and functions (`filterResources`, `searchInput`, `visibleCount`)
- CSS custom properties: kebab-case with category prefix (`--color-primary`, `--font-heading`)
- CSS class names: BEM-lite pattern for custom classes (`btn-primary`, `form-input`, `filter-select`, `hero-gradient`), Tailwind utilities everywhere else
- Python: snake_case functions and variables (`make_resource`, `save_resources`, `load_existing`)
- Nunjucks data: camelCase object access (`site.formspree.newsletter`, `resource.ageRange`)
- HTML IDs: kebab-case (`search-input`, `mobile-menu-btn`, `resource-grid`)

### Template Patterns
- All pages use YAML front matter: `layout`, `title`, `description`, `permalink`
- Layouts chain: content → `page.njk` or `post.njk` → `base.njk`
- Blog posts go in `src/blog/*.md` with the `post` layout
- Podcast episodes go in `src/podcast/*.md` with the `post` layout
- Components are Nunjucks partials included via `{% include "components/nav.njk" %}`
- Resource data is accessed as `resources.nova`, `resources.portland`, `resources.national` (Eleventy auto-loads `_data/resources/*.json`)

### Styling Approach
- Tailwind 4.x with `@theme` directive for custom design tokens in `src/css/styles.css`
- Brand colors (authoritative source is the `@theme` block in `src/css/styles.css`): primary (blue `#3A668C`), secondary (terracotta `#D77E5E`), accent (green `#6A9346`), highlight (gold `#FDB92E`), warm (cream `#F6EFDC`)
- Fonts: Nunito (headings), Open Sans (body) via Google Fonts
- Custom component classes defined in `styles.css`: `.card`, `.tag`, `.btn-primary`, `.btn-secondary`, `.form-input`, `.filter-select`, `.hero-gradient`, `.section-warm`, `.skip-nav`
- Inline `style` attributes use CSS custom properties for theming (e.g., `style="color: var(--color-primary);"`)
- Responsive breakpoints follow Tailwind defaults: `sm:`, `md:`, `lg:`

### Accessibility
- Skip navigation link on every page
- ARIA roles on header (`banner`), nav (`navigation`), footer (`contentinfo`)
- Mobile menu uses `aria-expanded` and `aria-controls`
- Nav links use `role="menubar"` and `role="menuitem"` pattern
- Focus-visible outline style using accent color
- `aria-hidden="true"` on decorative elements
- `sr-only` labels on form inputs without visible labels

### Scraper Conventions
- Each scraper module in `scrapers/sources/` must export a `scrape()` function
- Use `make_resource()` from `base_scraper.py` for consistent data schema
- Always merge with existing data via `merge_resources()` to preserve manual entries
- Deduplication key is `(name, location)` tuple
- Scrapers save to both `scrapers/output/` and `src/_data/resources/`
- `save_resources()` gates publication: existing entries update live; NEW entries queue to `pending/` for admin approval (see `scrapers/pending_store.py`)
- Rejected items land in `scrapers/blocklist.json` (urls + names) and are never re-queued — the three content scrapers check it too
- Tests: `python scrapers/test_pending_store.py` + `python scrapers/test_discovery_scrapers.py` (stdlib unittest, no deps)

### Resource Discovery vs Curated Catalogs (see `scrapers/README.md`)

The audit (June 2026) found the legacy "scrapers" were ~97% hand-curated seed lists, not live discovery, and the declared `scrapling` stack was never installed. Real automated discovery now comes from free, key-less, structured sources, each a module in `scrapers/sources/` auto-discovered by `run_all.py`:

- **Discovery scrapers** (`osm_overpass.py` — primary, OpenStreetMap Overpass; `cms_providers.py` — CMS home-health supplement; `news_leads.py` — Google News leads, OFF by default per ToS): query live sources and **queue-only** via `base_scraper.queue_new_resources()` — they NEVER write live files, so curated data is never overwritten. Dedup is case/whitespace-insensitive `(name, location)` via `pending_store.resource_key`.
- **Fail-loud**: `scrapers/_source_health.py` `SourceRun` logs `FAILED`/`PARSED_ZERO` (a source down, or HTTP-200-but-zero-parsed schema break) so `scrape_digest.py` surfaces it in the weekly email — no more silent seed-fallback hiding an outage.
- **Curated catalogs** (`national_resources.py`, `nova_resources.py`): hand-maintained lists; do NO live discovery (docstrings say so). Flow through `save_resources()`.
- **Extraction** (`scrapers/_extraction.py`): free schema.org/JSON-LD/OG/tel: field-fill; optional Claude-Haiku fallback is OFF unless `TFP_LLM_ENRICH=1` (paid). Never regex page body for phone (yields garbage).
- **Licence attribution** (required, in footer): OpenStreetMap ODbL + CMS public-domain.
- **Volume control**: OSM sweeps all 50 + DC rotated by week under `TFP_OSM_MAX_TOTAL`/`TFP_OSM_MAX_PER_STATE` caps (set in `scrape.yml`); `prune_stale()` expires unreviewed scraper items (news 28d, resources 60d) but never human submissions; runs as its own workflow step before commit.

### Resource Data Schema
```json
{
  "name": "Resource Name",
  "category": ["category-slug"],
  "location": "Northern Virginia | Portland | National",
  "area": "",
  "description": "What the resource does",
  "phone": "",
  "website": "https://...",
  "address": "",
  "ageRange": "",
  "disabilityTypes": [],
  "cost": "",
  "tags": ["tag1", "tag2"],
  "source": "https://...",
  "lastScraped": "2026-03-06",
  "dateAdded": "2026-06-12",
  "origin": { "type": "scraper | submission | quick-submit | bulk-import | curated", "detail": "module-or-form-name" }
}
```

**Optional app fields.** Entries in the `apps` category carry five extra fields; every other resource omits them:

```json
{
  "format": "app",
  "platforms": ["ios", "android", "web"],
  "pricing": "free | freemium | subscription | one-time",
  "appStore": "https://apps.apple.com/...",
  "playStore": "https://play.google.com/store/apps/details?id=..."
}
```

`format: "app"` drives the **App** badge that appears wherever the entry is rendered, including cross-listed topical category pages. `pricing` is the normalized filter key; the free-form `cost` string stays alongside it for human detail ("$14.99 one-time purchase"). Nothing in the scraper or worker pipeline produces these — they are hand-curated or added by an admin after approval.

### Caregiver Apps (`/resources/apps/`)

Apps live in the normal resource pipeline (`national.json`, `location: "National"`) but render from a dedicated template, because the generic category page filters by **State / City**, which is meaningless for national software. The apps page filters by **Function / Platform / Price** instead.

| Piece | File |
|---|---|
| Page | `src/pages/apps.njk` (`permalink: /resources/apps/`) |
| Card | `src/_includes/components/app-card.njk` |
| Filter JS | `src/js/appFilter.js` (supports `?function=` `?platform=` `?price=`) |
| Taxonomy | `src/_data/appTaxonomy.json` — functions, platform labels, pricing labels |

- **Function groups are granular category slugs**, not a field: `category: ["apps", "apps-communication", "assistive-tech"]`. The `apps-` prefix resolves to the `apps` top-level via `directory.js`, and the slug automatically becomes a Type filter chip on the cross-listed page. Labels must be added to **both** `appTaxonomy.json` and `subcategoryLabels.json`.
  > Slugs must be `apps-*`, with the s. `app-*` fails the `startsWith(top + '-')` prefix test in `directory.js` and falls through to `other`.
- **Cross-listing** puts an app on a topical page too (`assistive-tech`, `medical`, `community`, `emergency`). Only real top-level slugs from `categories.json` work — `communication` is a *facet* label, not a category, and would silently route to `other`.

> ⚠️ **`categoryPages.js` invariant.** `src/pages/preview/category.njk` paginates over `categoryPages`, not `categories`. `src/_data/categoryPages.js` filters out any slug in `DEDICATED_TEMPLATES` that owns a hand-built template. Add a slug there without building the template and the page vanishes from the site; build a template without adding the slug and the build dies on a duplicate permalink. Keep the two in lockstep.

### Gig Data Schema
```json
{
  "id": "gig-YYYYMMDD-XXXX",
  "title": "Gig title (max 120 chars)",
  "type": "seeking-help | offering-help",
  "category": "research | sewing | organization | tech-help | errands | meal-prep | respite | transportation | home-mods | tutoring | creative | admin | other",
  "description": "Full description",
  "location": "Northern Virginia | Portland | National",
  "remote": true,
  "compensation": "paid | volunteer | trade",
  "rate": "$25/hour (if paid)",
  "timeline": "Within 2 weeks",
  "postedDate": "2026-03-07",
  "expiresDate": "2026-03-21",
  "status": "open | expired | closed | removed",
  "posterFirstName": "First name only",
  "posterEmail": "PRIVATE — never rendered in templates",
  "skills": ["skill1", "skill2"],
  "tags": ["tag1"]
}
```

### Gig Platform Pipeline
- Gig submissions auto-publish via Formspree webhook → `gig-publish.yml` → `process_gig.py`
- Gigs auto-expire after 14 days; weekly scrape runs `process_gig.py --expire`
- Poster receives expiry notification email with option to extend or close
- `process_gig.py` supports: publish, `--expire`, `--extend <id>`, `--close <id>`, `--digest`

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Eleventy dev server + Tailwind watch (concurrent) |
| `npm run build` | Full production build (Eleventy then Tailwind with minify) |
| `npm run build:11ty` | Build Eleventy only |
| `npm run build:css` | Build Tailwind CSS only (minified) |
| `npm run serve` | Eleventy dev server without Tailwind watch |
| `npm run deploy` | Full build (deploy is handled by GitHub Pages on push) |
| `python scrapers/run_all.py` | Run all resource scrapers |

## Environment Variables

Deployment is handled automatically via GitHub Pages. No environment variables are needed for deploy — just push to `main`.

Legacy FTP variables (`FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`, `FTP_REMOTE_DIR`) are no longer used.

## CI/CD Workflows

### Build and Deploy (`.github/workflows/deploy.yml`)
Triggers on push to `main`. Installs Node 20, runs `npm run build`, deploys `_site/` to GitHub Pages.

### Weekly Scrape (`.github/workflows/scrape.yml`)
Runs every Sunday at midnight UTC (or manual trigger). Installs Python 3.12, runs all scrapers, commits updated resource data to the repo, then builds and deploys the site.

## Content Locations

| Content Type | Location | Format |
|-------------|----------|--------|
| Resource data | `src/_data/resources/*.json` | JSON arrays |
| Blog posts | `src/blog/*.md` | Markdown with YAML front matter |
| Podcast episodes | `src/podcast/*.md` | Markdown with YAML front matter |
| Static pages | `src/pages/*.njk` | Nunjucks templates |
| Site metadata | `src/_data/site.json` | JSON object |

## Third-Party Services

| Service | Purpose | Configuration |
|---------|---------|---------------|
| Formspree | Form notifications + no-JS fallback (contact, resource submission, newsletter) | Form IDs in `src/_data/site.json` under `formspree`. Resource + newsletter forms POST to the `tfp-admin-api` worker first and fall back to Formspree when it is unreachable. |
| Brevo | Email distribution database, newsletter double-opt-in, transactional thank-yous, campaigns | API key + list/template ids are `tfp-admin-api` worker secrets (`BREVO_*`). List "TFP Community"; contact attributes SOURCE, DATE_ADDED, OPT_IN_STATUS. |
| Cloudflare Workers | `gig-publisher` (`cloudflare-worker/`), `tfp-admin-api` (`cloudflare-worker-admin-api/`), `decap-oauth` (external repo) | Deployed via `npx wrangler deploy`; secrets in the Cloudflare dashboard (see each worker's README). |
| Decap CMS | Content editing at `/admin/` (blog, podcast, Site Pages) + entry to the review portal at `/admin/review/` | `src/admin/config.yml`; GitHub backend with OAuth via the decap-oauth worker. |
| Google Fonts | Nunito + Open Sans typefaces | Loaded in `base.njk` `<head>` |
| GitHub Pages | Static site hosting | Auto-deploys via `deploy.yml` workflow on push to main |
| GitHub Actions | CI/CD for build, deploy, and weekly scraping | `.github/workflows/` |


## Skill Usage Guide

When working on tasks involving these technologies, invoke the corresponding skill:

| Skill | Invoke When |
|-------|-------------|
| eleventy | Configures Eleventy 3.x collections, filters, and static site generation from Nunjucks templates |
| frontend-design | Designs UI with Tailwind CSS custom components, brand colors, and accessible component patterns |
| tailwind | Applies Tailwind CSS 4.x utility classes, @theme custom tokens, and responsive design |
| javascript | Writes vanilla JavaScript for mobile menu toggle and client-side resource filtering |
| nunjucks | Writes and manages Nunjucks templates, layouts, components, and data-driven page rendering |
| python | Develops Python 3.12 scrapers using scrapling and httpx for resource data collection |
| json | Structures resource data, site metadata, and scraper output in JSON format |
| ftp | Legacy — deployment now handled by GitHub Pages |
| github-actions | Configures CI/CD workflows for automated build, deploy, and weekly scraping jobs |
| markdown | Authors blog posts and podcast episodes with YAML front matter and markdown content |
| mapping-user-journeys | Maps in-app journeys and identifies friction points in code |
| scoping-feature-work | Breaks features into MVP slices and acceptance criteria |
| instrumenting-product-metrics | Defines product events, funnels, and activation metrics |
| designing-onboarding-paths | Designs onboarding paths, checklists, and first-run UI |
| orchestrating-feature-adoption | Plans feature discovery, nudges, and adoption flows |
| structuring-offer-ladders | Frames plan tiers, value ladders, and upgrade logic |
| designing-inapp-guidance | Builds tooltips, tours, and contextual guidance |
| crafting-page-messaging | Writes conversion-focused messaging for pages and key CTAs |
| tightening-brand-voice | Refines copy for clarity, tone, and consistency |
| clarifying-market-fit | Aligns ICP, positioning, and value narrative for on-page messaging |
| triaging-user-feedback | Routes feedback into backlog and quick wins |
| designing-lifecycle-messages | Designs onboarding and lifecycle email sequences |
| tuning-landing-journeys | Improves landing page flow, hierarchy, and conversion paths |
| mapping-conversion-events | Defines funnel events, tracking, and success signals |
| inspecting-search-coverage | Audits technical and on-page search coverage |
| adding-structured-signals | Adds structured data for rich results |
