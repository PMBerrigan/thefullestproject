const { test, expect } = require("@playwright/test");

/**
 * Pixel regression for the block-model refactor (Phases 2-3).
 *
 * Baselines are captured from the pre-refactor site. Converting a page from a
 * fixed template to an ordered list of blocks must not change a single pixel at
 * default settings, and these catch it if it does.
 *
 * Regenerate deliberately with: npx playwright test visual --update-snapshots
 */

const PAGES = [
  ["home", "/"],
  ["about", "/about/"],
  ["get-involved", "/get-involved/"],
  ["contact", "/contact/"],
  ["therapy-guide", "/therapy-guide/"],
  ["school-iep", "/school-iep/"],
  ["adaptive-equipment", "/adaptive-equipment/"],
  ["donate", "/donate/"],
  ["events", "/events/"],
  ["accessibility", "/accessibility/"],
];

test.describe("visual regression", () => {
  for (const [name, path] of PAGES) {
    test(`${name} renders unchanged`, async ({ page }) => {
      await page.goto(path);

      // Webfonts shift metrics; wait for them before shooting.
      await page.evaluate(() => document.fonts.ready);

      // Card hover transforms and transitions would make shots non-deterministic.
      await page.addStyleTag({
        content: "*,*::before,*::after{transition:none!important;animation:none!important}",
      });

      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.001,
        animations: "disabled",
      });
    });
  }
});
