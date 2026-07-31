const { test, expect } = require("@playwright/test");
const { openCms } = require("./helpers");

/**
 * Proves the CMS itself is drivable headlessly via decap-server.
 * Everything Nicole does lives behind this login, so if these break, the
 * editing features are unreachable regardless of what the site renders.
 */

test("CMS loads against the local backend and lists the editable collections", async ({ page }) => {
  await openCms(page);

  // The three things Nicole works with day to day.
  await expect(page.getByText("Articles", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Site Pages", { exact: false }).first()).toBeVisible();
});

test("Site Pages exposes Homepage, About and Design & Branding", async ({ page }) => {
  await openCms(page);

  await page.getByText("Site Pages", { exact: false }).first().click();

  for (const label of ["Homepage", "About Page", "Design & Branding"]) {
    await expect(page.getByText(label, { exact: false }).first(), label).toBeVisible();
  }
});
