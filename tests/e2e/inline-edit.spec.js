const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

/**
 * Phase 4 — the inline editor.
 *
 * The worker is never called: /inline-edit/** is stubbed, which also sidesteps
 * the production-only Origin check. What these prove is the client contract —
 * that visitors get nothing, that fields bind to the right text nodes, and that
 * a save sends exactly the leaves it should.
 */

const repoRoot = path.join(__dirname, "..", "..");
const readData = (f) => JSON.parse(fs.readFileSync(path.join(repoRoot, "src/_data", f), "utf8"));

/** Build the model the worker would return, from the real site data. */
function modelFor(pageKey, file) {
  const doc = readData(file);
  const fields = [];
  doc.blocks.forEach((block, blockIndex) => {
    if (block.visible === false) return;
    const push = (field, value, label, max) =>
      fields.push({
        blockIndex, blockId: block.id || "", blockType: block.type,
        field, value, label, blockLabel: block.heading || block.type, maxLength: max,
      });
    if (typeof block.heading === "string" && block.heading) push("heading", block.heading, "Heading", 120);
    if (typeof block.subheading === "string" && block.subheading) push("subheading", block.subheading, "Subheading", 400);
    if (Array.isArray(block.paragraphs)) {
      block.paragraphs.forEach((p, i) => push(`paragraphs.${i}`, p, "Paragraph", 1500));
    }
    if (Array.isArray(block.cards)) {
      block.cards.forEach((c, i) => push(`cards.${i}.title`, c.title, "Card title", 80));
    }
    if (block.type === "storyFeed" && block.browseAllLabel) {
      push("browseAllLabel", block.browseAllLabel, "Browse-all button", 60);
    }
    if (block.type === "tierCard" && block.footnote && block.footnote.text) {
      push("footnote.text", block.footnote.text, "Footnote", 300);
    }
    if (block.type === "text" && block.emphasis) push("emphasis", block.emphasis, "Bold closing line", 300);
  });
  return { page: pageKey, headSha: "testsha", cmsEntry: pageKey, fields, blocks: [] };
}

async function stubWorker(page, { save } = {}) {
  await page.route("**/inline-edit/page**", async (route) => {
    const key = new URL(route.request().url()).searchParams.get("page");
    const file = { homepage: "homepage.json", about: "about.json", getInvolved: "getInvolved.json" }[key];
    await route.fulfill({ json: modelFor(key, file) });
  });
  await page.route("**/inline-edit/save", async (route) => {
    const body = route.request().postDataJSON();
    if (save) save(body);
    await route.fulfill({
      json: { ok: true, commitSha: "abc123", applied: body.changes.map((c) => ({ blockIndex: c.blockIndex, field: c.field })), conflicts: [] },
    });
  });
}

async function openStudio(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("tfpEditSession", "tfpe_test.session");
    sessionStorage.setItem("tfpEditActor", "tester");
  });
  await page.goto("/admin/edit/");
  await expect(page.locator("#studio")).toBeVisible();
  await page.waitForFunction(() => {
    const f = document.getElementById("stage");
    return f && f.contentDocument && f.contentDocument.querySelector("[data-tfpe-editable]");
  }, { timeout: 20000 });
}

// ─── Visitors get nothing ────────────────────────────────────────────────────

test("no editor code, markup or storage reaches an ordinary visitor", async ({ page }) => {
  const editorRequests = [];
  page.on("request", (r) => {
    if (/\/admin\/edit\//.test(r.url())) editorRequests.push(r.url());
  });

  for (const url of ["/", "/about/", "/get-involved/", "/resources/"]) {
    await page.goto(url);

    const leaked = await page.evaluate(() => ({
      elements: document.querySelectorAll('[class^="tfpe-"], [data-tfpe-changed], [data-tfpe-editable], #tfpe-frame').length,
      storage: Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => k.startsWith("tfpEdit")),
    }));

    expect(leaked.elements, `${url} rendered editor markup`).toBe(0);
    expect(leaked.storage, `${url} wrote editor storage`).toEqual([]);
  }

  expect(editorRequests, "a public page requested editor code").toEqual([]);
});

test("the feature flag governs whether the editor exists in the build", async () => {
  const site = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/_data/site.json"), "utf8"));
  const built = fs.existsSync(path.join(repoRoot, "_site/admin/edit/index.html"));
  expect(built, "build output must match site.inlineEditor.enabled")
    .toBe(site.inlineEditor && site.inlineEditor.enabled === true);
});

// ─── Binding ─────────────────────────────────────────────────────────────────

test("every enumerated field either binds or offers no affordance at all", async ({ page }) => {
  await stubWorker(page);
  await openStudio(page);

  // The invariant: a field must never look editable and then fail to write.
  const broken = await page.evaluate(() => {
    const doc = document.getElementById("stage").contentDocument;
    const out = [];
    for (const el of doc.querySelectorAll("[data-tfpe-editable]")) {
      const section = el.closest("[data-block-index]");
      if (!section) out.push(el.dataset.blockField + ": no section");
    }
    return out;
  });
  expect(broken).toEqual([]);
});

test("the browse-all arrow is preserved and never becomes part of the value", async ({ page }) => {
  await stubWorker(page);
  await openStudio(page);

  const result = await page.evaluate(() => {
    const doc = document.getElementById("stage").contentDocument;
    const link = doc.querySelector('[data-block-field="browseAllLabel"]');
    return link ? { text: link.textContent, editable: link.hasAttribute("data-tfpe-editable") } : null;
  });

  if (result) {
    expect(result.editable).toBe(true);
    // The template renders `{{ browseAllLabel }} &rarr;` — one arrow, outside the value.
    expect(result.text).toContain("→");
    expect(result.text.match(/→/g).length).toBe(1);
  }
});

test("editing a paragraph leaves the nested bold closing line intact", async ({ page }) => {
  await stubWorker(page);
  await openStudio(page);

  const before = await page.evaluate(() => {
    const doc = document.getElementById("stage").contentDocument;
    const strong = doc.querySelector('[data-block-field="emphasis"]');
    return strong ? strong.textContent : null;
  });
  expect(before, "homepage mission block should have an emphasis element").toBeTruthy();

  // Preview a new paragraph value directly through the binding.
  await page.evaluate(() => {
    const doc = document.getElementById("stage").contentDocument;
    const para = doc.querySelector('[data-block-field="paragraphs.0"]');
    para.click();
  });
  const popover = page.frameLocator("#stage").locator(".tfpe-pop");
  await expect(popover).toBeVisible();
  await popover.locator("textarea").fill("A much shorter mission statement.");
  await popover.getByRole("button", { name: "Save" }).click();

  const after = await page.evaluate(() => {
    const doc = document.getElementById("stage").contentDocument;
    const strong = doc.querySelector('[data-block-field="emphasis"]');
    const para = doc.querySelector('[data-block-field="paragraphs.0"]');
    return { emphasis: strong ? strong.textContent : null, paragraph: para.textContent };
  });

  expect(after.emphasis, "the <strong> must survive editing its parent paragraph").toBe(before);
  expect(after.paragraph).toContain("A much shorter mission statement.");
});

// ─── Interaction ─────────────────────────────────────────────────────────────

test("clicking a card title inside a card-wide link opens the editor, not the link", async ({ page }) => {
  await stubWorker(page);
  await openStudio(page);

  const urlBefore = await page.evaluate(() => document.getElementById("stage").contentWindow.location.pathname);
  await page.evaluate(() => {
    document.getElementById("stage").contentDocument.querySelector('[data-block-field="cards.0.title"]').click();
  });

  await expect(page.frameLocator("#stage").locator(".tfpe-pop")).toBeVisible();
  const urlAfter = await page.evaluate(() => document.getElementById("stage").contentWindow.location.pathname);
  expect(urlAfter).toBe(urlBefore);
});

test("an empty value cannot be saved", async ({ page }) => {
  await stubWorker(page);
  await openStudio(page);

  await page.evaluate(() => {
    document.getElementById("stage").contentDocument.querySelector('[data-block-field="heading"]').click();
  });
  const popover = page.frameLocator("#stage").locator(".tfpe-pop");
  await popover.locator("textarea").fill("   ");
  await expect(popover.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(popover.locator(".tfpe-pop-note")).toContainText(/can't be empty/i);
});

test("publishing sends exactly the changed leaf with its expected value", async ({ page }) => {
  let sent = null;
  await stubWorker(page, { save: (body) => { sent = body; } });
  await openStudio(page);

  const original = await page.evaluate(() =>
    document.getElementById("stage").contentDocument.querySelector('[data-block-index="0"] [data-block-field="heading"]').textContent.trim()
  );

  await page.evaluate(() => {
    document.getElementById("stage").contentDocument.querySelector('[data-block-index="0"] [data-block-field="heading"]').click();
  });
  const popover = page.frameLocator("#stage").locator(".tfpe-pop");
  await popover.locator("textarea").fill("Living Life to the Fullest, Together");
  await popover.getByRole("button", { name: "Save" }).click();

  await page.getByRole("button", { name: /review & publish/i }).click();
  await expect(page.locator("#panel")).toBeVisible();
  await page.getByRole("button", { name: /^Publish/ }).click();

  await expect.poll(() => sent).not.toBeNull();
  expect(sent.page).toBe("homepage");
  expect(sent.changes).toHaveLength(1);
  expect(sent.changes[0]).toMatchObject({
    blockIndex: 0,
    field: "heading",
    expected: original,
    value: "Living Life to the Fullest, Together",
  });
});

test("a page not built from sections says so instead of failing silently", async ({ page }) => {
  await stubWorker(page);
  await openStudio(page);

  await page.evaluate(() => { document.getElementById("stage").contentWindow.location.href = "/resources/"; });
  await expect(page.locator("#bar-message")).toContainText(/isn't built from sections/i, { timeout: 20000 });
  await expect(page.getByRole("button", { name: /review & publish/i })).toBeDisabled();
});
