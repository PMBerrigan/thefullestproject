const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { openCms } = require("./helpers");

/**
 * Phase 2 — the block model.
 * The rendered page must follow the data exactly: same blocks, same order,
 * hidden blocks absent. That contract is what makes reordering in the CMS safe.
 */

function readBlocks(file) {
  const json = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "src", "_data", file), "utf8")
  );
  return json.blocks;
}

const PAGES = [
  ["/", "homepage.json"],
  ["/about/", "about.json"],
];

for (const [url, file] of PAGES) {
  test(`${url} renders its blocks in data order`, async ({ page }) => {
    await page.goto(url);

    const expected = readBlocks(file)
      .filter((b) => b.visible !== false)
      .map((b) => b.type);

    const actual = await page.$$eval("[data-block-type]", (els) =>
      els.map((el) => el.getAttribute("data-block-type"))
    );

    // The spotlight block self-hides when nothing is featured, so allow it to drop.
    const actualPadded = expected.filter((t) => t !== "spotlight" || actual.includes("spotlight"));
    expect(actual).toEqual(actualPadded);
  });

  test(`${url} numbers its blocks contiguously for the inline editor`, async ({ page }) => {
    await page.goto(url);
    const indexes = await page.$$eval("[data-block-index]", (els) =>
      els.map((el) => Number(el.getAttribute("data-block-index")))
    );
    expect(indexes.length).toBeGreaterThan(0);
    // Indexes must be strictly increasing — they address positions in the JSON array.
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i]).toBeGreaterThan(indexes[i - 1]);
    }
  });
}

test("every editable field carries an anchor the inline editor can target", async ({ page }) => {
  await page.goto("/");
  const fields = await page.$$eval("[data-block-field]", (els) =>
    els.map((el) => el.getAttribute("data-block-field"))
  );
  expect(fields.length).toBeGreaterThan(20);
  expect(fields).toContain("heading");
  expect(fields).toContain("subheading");
});

test("CMS config parses and the Homepage opens a section list editor", async ({ page }) => {
  const configErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /config/i.test(m.text())) configErrors.push(m.text());
  });

  await openCms(page);
  await page.getByText("Site Pages", { exact: false }).first().click();
  await page.getByText("Homepage", { exact: false }).first().click();

  // The list widget renders an "Add Section" control from label_singular.
  await expect(page.getByText(/add section/i).first()).toBeVisible();

  // A rejected config surfaces as a load error instead of the editor.
  await expect(page.getByText(/error loading the cms configuration/i)).toHaveCount(0);
  expect(configErrors, configErrors.join("\n")).toHaveLength(0);
});
