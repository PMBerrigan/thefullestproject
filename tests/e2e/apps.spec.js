// Caregiver Apps page: grouping, the function/platform/price filters, and the
// cross-listing that puts badged app cards on topical category pages.
//
// Counts below are tied to the curated seed set in national.json. If you add or
// remove an app, update them — a drifting count here is the signal that a data
// change silently altered the page, which is exactly what this guards.
const { test, expect } = require("@playwright/test");

const visible = (page) => page.locator(".app-card:visible").count();

test("apps page groups, filters, and deep links", async ({ page }) => {
  await page.goto("/resources/apps/");

  expect(await visible(page)).toBe(6);
  await expect(page.locator("#app-results-count")).toHaveText("6 apps shown");
  // 5 of the 6 taxonomy groups have apps; apps-safety-gps is currently empty
  await expect(page.locator("[data-app-group]:visible")).toHaveCount(5);

  // An empty group must not be offered as a filter that returns nothing
  const fnOptions = await page.locator("#app-function-filter option").evaluateAll(
    (opts) => opts.map((o) => o.value)
  );
  expect(fnOptions).not.toContain("apps-safety-gps");

  // Filtering to one function hides the other headings, so a filter never
  // leaves a stranded group title over empty space.
  await page.selectOption("#app-function-filter", "apps-care-coordination");
  expect(await visible(page)).toBe(2);
  await expect(page.locator("[data-app-group]:visible")).toHaveCount(1);
  await expect(page.locator("#app-results-count")).toHaveText("2 apps shown");

  // Device filter drops the Apple-only apps
  await page.selectOption("#app-function-filter", "");
  await page.selectOption("#app-platform-filter", "android");
  const androidNames = await page.locator(".app-card:visible h3").allTextContents();
  expect(androidNames).not.toContain("Proloquo2Go");
  expect(androidNames).toContain("Medisafe");
  expect(androidNames).toContain("NeuraParent");

  // Cost filter uses the normalized `pricing` field, not the free-form `cost`
  await page.selectOption("#app-platform-filter", "");
  await page.selectOption("#app-price-filter", "free");
  const freeNames = await page.locator(".app-card:visible h3").allTextContents();
  expect(freeNames.sort()).toEqual(["CaringBridge", "Wheelmap"]);

  // Search covers name + description
  await page.selectOption("#app-price-filter", "");
  await page.fill("#app-search", "meltdown");
  expect(await visible(page)).toBe(1);
  await expect(page.locator(".app-card:visible h3")).toHaveText("NeuraParent");

  await page.fill("#app-search", "zzzznope");
  expect(await visible(page)).toBe(0);
  await expect(page.locator("#app-no-results")).toBeVisible();

  // ?function=/?platform=/?price= deep links, mirroring the category pages
  await page.goto("/resources/apps/?function=apps-communication&price=one-time");
  expect(await visible(page)).toBe(1);
  await expect(page.locator(".app-card:visible h3")).toHaveText("Proloquo2Go");
});

test("cross-listed apps are badged on topical category pages", async ({ page }) => {
  await page.goto("/resources/assistive-tech/");
  const badged = page.locator('.resource-card[data-format="app"]');
  await expect(badged).toHaveCount(1); // Proloquo2Go
  await expect(badged.first().locator("span.tag")).toHaveText("App");

  await page.goto("/resources/community/");
  await expect(page.locator('.resource-card[data-format="app"]')).toHaveCount(3);

  // The apps-* function slug deep-links as a Type filter, via the facet
  // machinery in directory.js — with a human label from subcategoryLabels.json.
  // categoryFilter.js injects the option when the facet is too rare to have
  // earned a dropdown slot on its own, so the link works either way.
  await page.goto("/resources/assistive-tech/?type=apps-communication");
  await expect(page.locator(".resource-card:visible")).toHaveCount(1);
  await expect(page.locator("#type-filter")).toHaveValue("apps-communication");
  const label = await page.locator("#type-filter option:checked").textContent();
  expect(label).toContain("Communication (AAC)");
});
