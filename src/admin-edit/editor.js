/**
 * Edit Studio — click a word on the page, change it, publish.
 *
 * The public site is loaded into a same-origin iframe inside this admin shell.
 * Nothing here is ever added to a page a visitor loads: base.njk is untouched,
 * and this whole directory is only copied into the build when
 * site.inlineEditor.enabled is true.
 *
 * Editing is deliberately narrow. The server enumerates which text may change
 * (see cloudflare-worker-admin-api/editable-fields.js) and this client makes
 * editable only what that response lists, so the two cannot drift apart. Links,
 * section order, show/hide, backgrounds and adding or removing anything all
 * stay in the Content Manager.
 */

import { findElement, locateValue, applyPreview } from "./bind.js";
import {
  getSession, getActor, signOut, exchange, existingGithubToken, signInWithPopup,
} from "./auth.js";

const ADMIN_API = "https://tfp-admin-api.patrick-m-berrigan.workers.dev";

const PAGE_KEYS = { "/": "homepage", "/about/": "about", "/get-involved/": "getInvolved" };
const PAGE_LABELS = { homepage: "Homepage", about: "About Page", getInvolved: "Get Involved" };

const DRAFT_PREFIX = "tfpEditDraft:";
const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;
const PUBLISHED_KEY = "tfpEditPublished";
const PUBLISHED_TTL_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 15000;

const el = (id) => document.getElementById(id);

const state = {
  pageKey: null,
  model: null,          // { headSha, fields[], blocks[] } from the server
  bindings: new Map(),  // "blockIndex|field" -> { field, el, binding }
  draft: {},            // "blockIndex|field" -> { expected, value, label, blockLabel, before }
  pollTimer: null,
};

// ─── Sign-in ─────────────────────────────────────────────────────────────────

function showSignInError(message) {
  el("signin-status").textContent = message;
}

async function tryExchange(token) {
  showSignInError("Signing in…");
  const result = await exchange(ADMIN_API, token);
  if (result.error) { showSignInError(result.error); return; }
  startStudio();
}

function initSignIn() {
  el("signin-btn").addEventListener("click", () => {
    signInWithPopup(tryExchange, showSignInError);
  });
  el("pat-btn").addEventListener("click", () => {
    const token = el("pat").value.trim();
    if (!token) { showSignInError("Paste a token first."); return; }
    tryExchange(token);
  });

  // Arriving from the review portal, which already has a token in this tab.
  const existing = existingGithubToken();
  if (existing) tryExchange(existing);
}

// ─── Studio ──────────────────────────────────────────────────────────────────

function startStudio() {
  el("signin").hidden = true;
  el("studio").hidden = false;

  const picker = el("page-picker");
  picker.innerHTML = "";
  for (const [pathname, key] of Object.entries(PAGE_KEYS)) {
    const option = document.createElement("option");
    option.value = pathname;
    option.textContent = PAGE_LABELS[key];
    picker.appendChild(option);
  }
  picker.addEventListener("change", () => { el("stage").src = picker.value; });

  el("review-btn").addEventListener("click", openPanel);
  el("panel-close").addEventListener("click", () => { el("panel").hidden = true; });
  el("publish-btn").addEventListener("click", publish);
  el("done-btn").addEventListener("click", () => {
    if (countChanges() && !confirm("You have unpublished changes. They'll be kept as a draft. Leave anyway?")) return;
    signOut();
    location.assign("/admin/review/");
  });

  el("stage").addEventListener("load", onStageLoad);
  el("stage").src = "/";
}

function currentPathname() {
  const frame = el("stage");
  try {
    let pathname = frame.contentWindow.location.pathname.replace(/index\.html$/, "");
    if (!pathname.endsWith("/")) pathname += "/";
    return pathname === "//" ? "/" : pathname;
  } catch {
    return null; // cross-origin, i.e. the framing assumption broke
  }
}

async function onStageLoad() {
  state.bindings.clear();

  const pathname = currentPathname();
  if (pathname === null) {
    setBar("The editor can't open the page right now — use the Content Manager.", "warn");
    return;
  }

  const pageKey = PAGE_KEYS[pathname];
  el("page-picker").value = PAGE_KEYS[pathname] ? pathname : "";

  if (!pageKey) {
    state.pageKey = null;
    state.model = null;
    setBar("Editing isn't available on this page — it isn't built from sections.", "warn");
    el("review-btn").disabled = true;
    return;
  }

  state.pageKey = pageKey;
  state.draft = loadDraft(pageKey);

  const model = await fetchModel(pageKey);
  if (!model) return;
  state.model = model;

  injectFrameStyles();
  bindFields();
  applyPendingPublish();
  offerResume();
  updateBar();
}

async function fetchModel(pageKey) {
  let res;
  try {
    res = await fetch(ADMIN_API + "/inline-edit/page?page=" + encodeURIComponent(pageKey), {
      headers: { "X-Edit-Session": getSession() },
    });
  } catch {
    setBar("Couldn't load this page's text. Check your connection.", "warn");
    return null;
  }
  if (res.status === 401) {
    setBar("Your editing session expired — sign in again.", "warn");
    signOut();
    el("studio").hidden = true;
    el("signin").hidden = false;
    return null;
  }
  if (!res.ok) {
    setBar("Couldn't load this page's text.", "warn");
    return null;
  }
  return res.json();
}

/** Affordance styles live inside the iframe and are re-injected on navigation. */
function injectFrameStyles() {
  const doc = el("stage").contentDocument;
  if (!doc || doc.getElementById("tfpe-frame")) return;
  const style = doc.createElement("style");
  style.id = "tfpe-frame";
  style.textContent = `
    [data-tfpe-editable]{outline:1px dashed rgba(58,102,140,.45);outline-offset:3px;cursor:text;transition:outline-color .15s}
    [data-tfpe-editable]:hover{outline:2px solid #3A668C;outline-offset:3px}
    [data-tfpe-changed]{box-shadow:-4px 0 0 #E8913A}
    [data-tfpe-pending]{box-shadow:-4px 0 0 #6A9346}
    .tfpe-pop{position:absolute;z-index:2147483647;background:#fff;border:1px solid #E2E8F0;border-radius:10px;
      box-shadow:0 8px 28px rgba(0,0,0,.18);padding:12px;width:min(440px,92vw);font-family:system-ui,sans-serif}
    .tfpe-pop textarea{width:100%;min-height:72px;padding:8px;border:2px solid #E2E8F0;border-radius:6px;
      font:inherit;resize:vertical}
    .tfpe-pop-row{display:flex;align-items:center;gap:8px;margin-top:8px}
    .tfpe-pop-count{font-size:12px;color:#636E72;margin-right:auto}
    .tfpe-pop button{font:inherit;font-size:13px;font-weight:600;padding:6px 12px;border-radius:6px;
      border:1px solid #E2E8F0;background:#fff;cursor:pointer}
    .tfpe-pop button.primary{background:#3A668C;border-color:#3A668C;color:#fff}
    .tfpe-pop button:disabled{opacity:.45;cursor:not-allowed}
    .tfpe-pop-note{font-size:12px;color:#C0392B;margin:6px 0 0}
  `;
  doc.head.appendChild(style);

  // Capture phase: intercept clicks on bound fields before the page's own
  // handlers, so a card-wide <a>, a CTA link, or a submit button can be edited
  // without navigating or submitting. Ordinary links are untouched — that is
  // how she moves between pages.
  doc.addEventListener("click", onFrameClick, true);
}

function bindFields() {
  const doc = el("stage").contentDocument;
  for (const field of state.model.fields) {
    const found = findElement(doc, field);
    if (found.error) continue;
    const binding = locateValue(found.el, field.value);
    if (binding.error) continue;

    const key = field.blockIndex + "|" + field.field;
    state.bindings.set(key, { field, el: found.el, binding });
    found.el.setAttribute("data-tfpe-editable", "");

    const staged = state.draft[key];
    if (staged) {
      applyPreview(binding, staged.value);
      found.el.setAttribute("data-tfpe-changed", "");
    }
  }
}

function onFrameClick(event) {
  const target = event.target.closest("[data-block-field]");
  if (!target || !target.hasAttribute("data-tfpe-editable")) return;

  const section = target.closest("[data-block-index]");
  const key = section.dataset.blockIndex + "|" + target.dataset.blockField;
  if (!state.bindings.has(key)) return;

  event.preventDefault();
  event.stopPropagation();
  openPopover(key);
}

// ─── Editing popover ─────────────────────────────────────────────────────────

function closePopover() {
  const doc = el("stage").contentDocument;
  const existing = doc.querySelector(".tfpe-pop");
  if (existing) existing.remove();
}

function openPopover(key) {
  closePopover();

  const doc = el("stage").contentDocument;
  const entry = state.bindings.get(key);
  const staged = state.draft[key];
  const currentValue = staged ? staged.value : entry.field.value;

  const pop = doc.createElement("div");
  pop.className = "tfpe-pop";
  pop.innerHTML = `
    <label style="font-size:12px;color:#636E72;display:block;margin-bottom:4px"></label>
    <textarea autocapitalize="off" autocorrect="off" spellcheck="true"></textarea>
    <p class="tfpe-pop-note" hidden></p>
    <div class="tfpe-pop-row">
      <span class="tfpe-pop-count"></span>
      <button type="button" data-act="reset">Reset</button>
      <button type="button" data-act="cancel">Cancel</button>
      <button type="button" data-act="save" class="primary">Save</button>
    </div>`;

  pop.querySelector("label").textContent = entry.field.blockLabel + " · " + entry.field.label;
  const textarea = pop.querySelector("textarea");
  const count = pop.querySelector(".tfpe-pop-count");
  const note = pop.querySelector(".tfpe-pop-note");
  const saveBtn = pop.querySelector('[data-act="save"]');
  textarea.value = currentValue;

  // Read as inline as possible: inherit the field's own type styling.
  const computed = doc.defaultView.getComputedStyle(entry.el);
  textarea.style.fontFamily = computed.fontFamily;
  textarea.style.fontSize = computed.fontSize;
  textarea.style.fontWeight = computed.fontWeight;

  function refresh() {
    const value = textarea.value;
    const tooLong = value.length > entry.field.maxLength;
    const empty = value.trim() === "";
    count.textContent = value.length + " / " + entry.field.maxLength;
    count.style.color = tooLong ? "#C0392B" : "#636E72";
    note.hidden = !(empty || tooLong);
    note.textContent = empty
      ? "Text can't be empty. To remove a whole section, use the Content Manager."
      : "That's too long for this spot.";
    saveBtn.disabled = empty || tooLong;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 240) + "px";
  }

  textarea.addEventListener("input", refresh);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!saveBtn.disabled) commit(); }
    if (e.key === "Escape") { e.preventDefault(); closePopover(); }
  });

  pop.addEventListener("click", (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === "cancel") closePopover();
    if (act === "reset") { textarea.value = entry.field.value; refresh(); textarea.focus(); }
    if (act === "save") commit();
  });

  function commit() {
    stageChange(key, textarea.value.trim());
    closePopover();
  }

  const rect = entry.el.getBoundingClientRect();
  pop.style.top = (rect.bottom + doc.defaultView.scrollY + 8) + "px";
  pop.style.left = Math.max(8, rect.left + doc.defaultView.scrollX) + "px";
  doc.body.appendChild(pop);

  refresh();
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

// ─── Draft ───────────────────────────────────────────────────────────────────

function stageChange(key, value) {
  const entry = state.bindings.get(key);
  if (value === entry.field.value) {
    delete state.draft[key];
    applyPreview(entry.binding, entry.field.value);
    entry.el.removeAttribute("data-tfpe-changed");
  } else {
    state.draft[key] = {
      expected: entry.field.value,
      value,
      label: entry.field.label,
      blockLabel: entry.field.blockLabel,
      blockIndex: entry.field.blockIndex,
      blockId: entry.field.blockId,
      field: entry.field.field,
    };
    applyPreview(entry.binding, value);
    entry.el.setAttribute("data-tfpe-changed", "");
  }
  saveDraft();
  updateBar();
}

function draftKey(pageKey) { return DRAFT_PREFIX + pageKey; }

function saveDraft() {
  if (!state.pageKey) return;
  const payload = { savedAt: Date.now(), headSha: state.model && state.model.headSha, changes: state.draft };
  try { localStorage.setItem(draftKey(state.pageKey), JSON.stringify(payload)); } catch { /* quota */ }
}

function loadDraft(pageKey) {
  try {
    const raw = localStorage.getItem(draftKey(pageKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(draftKey(pageKey));
      return {};
    }
    return parsed.changes || {};
  } catch { return {}; }
}

function clearDraft() {
  state.draft = {};
  if (state.pageKey) localStorage.removeItem(draftKey(state.pageKey));
}

function countChanges() { return Object.keys(state.draft).length; }

/**
 * If a draft was written before someone else changed the same text, say so
 * before more work goes into it rather than at publish time.
 */
function offerResume() {
  const notice = el("resume");
  const stale = Object.entries(state.draft).filter(([key, change]) => {
    const entry = state.bindings.get(key);
    return entry && entry.field.value !== change.expected;
  });

  if (!stale.length) { notice.hidden = true; return; }

  notice.hidden = false;
  notice.textContent = "";
  const text = document.createElement("span");
  text.textContent = stale.length === 1
    ? "The live text for “" + stale[0][1].label + "” changed since you started."
    : stale.length + " of your unfinished changes are based on text that has since changed.";
  const useLive = document.createElement("button");
  useLive.className = "tfpe-btn";
  useLive.textContent = "Start from the live text";
  useLive.addEventListener("click", () => {
    for (const [key] of stale) {
      const entry = state.bindings.get(key);
      delete state.draft[key];
      if (entry) { applyPreview(entry.binding, entry.field.value); entry.el.removeAttribute("data-tfpe-changed"); }
    }
    saveDraft(); updateBar(); notice.hidden = true;
  });
  const keepMine = document.createElement("button");
  keepMine.className = "tfpe-btn";
  keepMine.textContent = "Keep my wording";
  keepMine.addEventListener("click", () => {
    for (const [key] of stale) {
      const entry = state.bindings.get(key);
      if (entry) state.draft[key].expected = entry.field.value;
    }
    saveDraft(); notice.hidden = true;
  });

  notice.append(text, useLive, keepMine);
}

// ─── Review & publish ────────────────────────────────────────────────────────

function setBar(message, tone) {
  const bar = el("bar-message");
  bar.textContent = message;
  if (tone) bar.setAttribute("data-tone", tone); else bar.removeAttribute("data-tone");
}

function updateBar() {
  const n = countChanges();
  el("review-btn").disabled = n === 0;
  el("review-btn").textContent = n ? "Review & publish (" + n + ")" : "Review & publish";
  if (n === 0) setBar("Nothing is live until you publish");
  else setBar(n === 1 ? "1 unpublished change" : n + " unpublished changes", "changed");
}

function openPanel() {
  const list = el("panel-list");
  list.textContent = "";

  const entries = Object.entries(state.draft);
  if (!entries.length) {
    list.innerHTML = '<p class="tfpe-empty">No changes yet.</p>';
  }
  for (const [key, change] of entries) {
    const row = document.createElement("div");
    row.className = "tfpe-change";

    const label = document.createElement("div");
    label.className = "tfpe-change-label";
    label.textContent = change.blockLabel + " · " + change.label;

    const before = document.createElement("div");
    before.className = "tfpe-change-before";
    before.textContent = change.expected;

    const after = document.createElement("div");
    after.className = "tfpe-change-after";
    after.textContent = change.value;

    const actions = document.createElement("div");
    actions.className = "tfpe-change-actions";
    const discard = document.createElement("button");
    discard.className = "tfpe-btn tfpe-btn-danger";
    discard.textContent = "Discard this change";
    discard.addEventListener("click", () => {
      const entry = state.bindings.get(key);
      delete state.draft[key];
      if (entry) { applyPreview(entry.binding, entry.field.value); entry.el.removeAttribute("data-tfpe-changed"); }
      saveDraft(); updateBar(); openPanel();
    });
    actions.appendChild(discard);

    row.append(label, before, after, actions);
    list.appendChild(row);
  }

  el("publish-btn").disabled = entries.length === 0;
  el("publish-btn").textContent = entries.length === 1 ? "Publish 1 change" : "Publish " + entries.length + " changes";
  el("panel").hidden = false;
}

async function publish() {
  const entries = Object.entries(state.draft);
  if (!entries.length) return;

  const button = el("publish-btn");
  button.disabled = true;
  button.textContent = "Publishing…";

  const payload = {
    page: state.pageKey,
    baseSha: state.model.headSha,
    changes: entries.map(([, c]) => ({
      blockIndex: c.blockIndex, blockId: c.blockId, field: c.field,
      expected: c.expected, value: c.value,
    })),
  };

  let res, body;
  try {
    res = await fetch(ADMIN_API + "/inline-edit/save", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Edit-Session": getSession() },
      body: JSON.stringify(payload),
    });
    body = await res.json();
  } catch {
    button.disabled = false;
    button.textContent = "Publish";
    setBar("Couldn't reach the server — your changes are still saved here.", "warn");
    return;
  }

  if (res.status === 429) {
    button.disabled = false;
    button.textContent = "Publish";
    setBar(body.error || "Just a moment — the last change is still publishing.", "warn");
    return;
  }

  if (res.status === 409 || (body.conflicts && body.conflicts.length)) {
    renderConflicts(body.conflicts || []);
    button.disabled = false;
    button.textContent = "Publish";
    if (!body.ok) return;
  }

  if (!res.ok && res.status !== 409) {
    button.disabled = false;
    button.textContent = "Publish";
    setBar(body.error || "That couldn't be saved.", "warn");
    return;
  }

  // Applied. Remember what went out so the page can keep showing it while
  // GitHub Pages catches up.
  const values = {};
  for (const applied of body.applied) {
    const key = applied.blockIndex + "|" + applied.field;
    if (state.draft[key]) values[key] = state.draft[key].value;
    delete state.draft[key];
  }
  saveDraft();
  try {
    localStorage.setItem(PUBLISHED_KEY, JSON.stringify({
      page: state.pageKey, commitSha: body.commitSha, at: Date.now(), values,
    }));
  } catch { /* quota */ }

  el("panel").hidden = true;
  updateBar();
  setBar("Saved. The live site updates in about 2 minutes.", "changed");
  startPolling();
}

function renderConflicts(conflicts) {
  const list = el("panel-list");
  for (const conflict of conflicts) {
    const key = conflict.blockIndex + "|" + conflict.field;
    const mine = state.draft[key];
    const box = document.createElement("div");
    box.className = "tfpe-conflict";

    const heading = document.createElement("p");
    heading.innerHTML = "<strong></strong>";
    heading.querySelector("strong").textContent = conflict.message;
    box.appendChild(heading);

    if (conflict.reason === "changed-elsewhere" && mine) {
      const live = document.createElement("p");
      live.textContent = "It now says: " + conflict.current;
      const ours = document.createElement("p");
      ours.textContent = "Your version: " + mine.value;

      const useLive = document.createElement("button");
      useLive.className = "tfpe-btn";
      useLive.textContent = "Use the live text";
      useLive.addEventListener("click", () => {
        delete state.draft[key];
        saveDraft(); updateBar(); openPanel();
      });

      const useMine = document.createElement("button");
      useMine.className = "tfpe-btn tfpe-btn-primary";
      useMine.textContent = "Use my version";
      useMine.addEventListener("click", () => {
        // Re-check against the value the server just reported — still a checked
        // write on the second attempt, never a forced one.
        state.draft[key].expected = conflict.current;
        saveDraft(); publish();
      });

      box.append(live, ours, useLive, useMine);
    } else if (conflict.reason === "section-moved") {
      const reload = document.createElement("button");
      reload.className = "tfpe-btn";
      reload.textContent = "Reload the page";
      reload.addEventListener("click", () => { el("panel").hidden = true; el("stage").contentWindow.location.reload(); });
      box.appendChild(reload);
    } else {
      const link = document.createElement("a");
      link.className = "tfpe-btn";
      link.href = "/admin/#/collections/siteContent/entries/" + (state.model.cmsEntry || state.pageKey);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Open the Content Manager";
      box.appendChild(link);
    }

    list.prepend(box);
  }
}

// ─── Two-stage truth: keep showing the new words until the deploy lands ──────

function pendingPublish() {
  try {
    const raw = localStorage.getItem(PUBLISHED_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (!record.at || Date.now() - record.at > PUBLISHED_TTL_MS) {
      localStorage.removeItem(PUBLISHED_KEY);
      return null;
    }
    return record;
  } catch { return null; }
}

function applyPendingPublish() {
  const record = pendingPublish();
  if (!record || record.page !== state.pageKey) return;

  for (const [key, value] of Object.entries(record.values)) {
    const entry = state.bindings.get(key);
    if (!entry) continue;
    applyPreview(entry.binding, value);
    entry.el.setAttribute("data-tfpe-pending", "");
  }
  setBar("Published — waiting for the live site to catch up.", "changed");
  startPolling();
}

function startPolling() {
  stopPolling();
  el("progress").hidden = false;
  const started = Date.now();

  state.pollTimer = setInterval(async () => {
    const record = pendingPublish();
    if (!record) { stopPolling(); return; }

    const elapsed = Date.now() - record.at;
    el("progress").querySelector(".tfpe-progress-fill").style.width =
      Math.min(95, (elapsed / 120000) * 100) + "%";

    if (elapsed > PUBLISHED_TTL_MS) {
      stopPolling();
      localStorage.removeItem(PUBLISHED_KEY);
      // Never claim failure: the commit did succeed, the deploy is just slow.
      setBar("Still not live after 20 minutes. Your change is saved — ask Patrick to check the deploy.", "warn");
      el("stage").contentWindow.location.reload();
      return;
    }

    // Confirmation is content-based rather than asking the Actions API, which
    // legitimately reports "cancelled" for a queued-then-superseded run.
    const pathname = Object.keys(PAGE_KEYS).find((p) => PAGE_KEYS[p] === record.page) || "/";
    let html;
    try {
      const res = await fetch(pathname + "?tfpcb=" + encodeURIComponent(record.commitSha), { cache: "no-store" });
      html = await res.text();
    } catch { return; }

    const live = Object.values(record.values).every((value) => html.includes(escapeForHtml(value)));
    if (!live) return;

    stopPolling();
    localStorage.removeItem(PUBLISHED_KEY);
    setBar("It's live.", "live");
    el("stage").contentWindow.location.replace(pathname + "?tfpcb=" + encodeURIComponent(record.commitSha));
  }, POLL_INTERVAL_MS);

  // Nudge the first check sooner than a full interval.
  if (Date.now() - started < 1000) setTimeout(() => {}, 0);
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  el("progress").hidden = true;
}

/** Values render through Nunjucks autoescaping, so match the escaped form. */
function escapeForHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;")
    .replace(/'/g, "&#39;");
}

// ─── Boot ────────────────────────────────────────────────────────────────────

if (getSession()) startStudio();
else initSignIn();

// Exposed for the e2e suite to assert against without reaching into internals.
window.__tfpe = { state, PAGE_KEYS };
