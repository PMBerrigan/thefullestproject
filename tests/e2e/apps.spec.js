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

  expect(await visible(page)).toBe(11);
  await expect(page.locator("#app-results-count")).toHaveText("11 apps shown");
  expect(await page.locator("[data-app-group]:visible").count()).toBe(6);

  // Filtering to one function hides the other five headings, so a filter never
  // leaves a stranded group title over empty space.
  await page.selectOption("#app-function-filter", "apps-communication");
  expect(await visible(page)).toBe(2);
  expect(await page.locator("[data-app-group]:visible").count()).toBe(1);
  await expect(page.locator("#app-results-count")).toHaveText("2 apps shown");

  // Device filter drops the iOS-only apps
  await page.selectOption("#app-function-filter", "");
  await page.selectOption("#app-platform-filter", "android");
  const androidNames = await page.locator(".app-card:visible h3").allTextContents();
  expect(androidNames).not.toContain("Proloquo2Go");
  expect(androidNames).not.toContain("Symple Symptom Tracker");
  expect(androidNames).not.toContain("First Then Visual Schedule");
  expect(androidNames).toContain("Medisafe");

  // Cost filter uses the normalized `pricing` field, not the free-form `cost`
  await page.selectOption("#app-platform-filter", "");
  await page.selectOption("#app-price-filter", "free");
  const freeNames = await page.locator(".app-card:visible h3").allTextContents();
  expect(freeNames.sort()).toEqual(["CaringBridge", "Wheelmap"]);

  // Search covers name + description
  await page.selectOption("#app-price-filter", "");
  await page.fill("#app-search", "wandering");
  expect(await visible(page)).toBe(1);
  await expect(page.locator(".app-card:visible h3")).toHaveText("Life360");

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
  expect(await badged.count()).toBe(4);
  await expect(badged.first().locator("span.tag")).toHaveText("App");

  // The apps-* function slug becomes a Type chip here for free, via the facet
  // machinery in directory.js — with a human label from subcategoryLabels.json.
  await page.goto("/resources/assistive-tech/?type=apps-communication");
  expect(await page.locator(".resource-card:visible").count()).toBe(2);
  await expect(page.locator("#type-filter")).toHaveValue("apps-communication");
  const label = await page.locator("#type-filter option:checked").textContent();
  expect(label).toContain("Communication (AAC)");
});
