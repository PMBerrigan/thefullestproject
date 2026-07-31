const { test, expect } = require("@playwright/test");
const { openCms, cssVar } = require("./helpers");

/**
 * Phase 1 — Design & Branding.
 * Every knob in the panel must reach the rendered page as a CSS variable, and
 * the preview pane must show them without saving.
 */

test("generated theme-preview.css carries every brand variable", async ({ request }) => {
  const res = await request.get("/admin/theme-preview.css");
  expect(res.status()).toBe(200);
  const css = await res.text();

  for (const v of [
    "--color-primary",
    "--color-warm-light",
    "--color-sky",
    "--color-primary-dark",
    "--radius-button",
    "--radius-card",
    "--space-section",
    "--font-heading",
  ]) {
    expect(css, `${v} missing from theme-preview.css`).toContain(v);
  }
});

test("live pages expose the corner, spacing and derived colour variables", async ({ page }) => {
  await page.goto("/");

  expect(await cssVar(page, "--radius-button")).toBeTruthy();
  expect(await cssVar(page, "--radius-card")).toBeTruthy();
  expect(await cssVar(page, "--space-section")).toBeTruthy();

  // Derived, not hardcoded — this is what makes a colour change carry through.
  expect(await cssVar(page, "--color-primary-dark")).toContain("color-mix");
});

test("cards and buttons actually consume the corner-style variable", async ({ page }) => {
  await page.goto("/");

  // Prove the wiring by changing the variable at runtime and watching the DOM follow.
  const card = page.locator(".card").first();
  await expect(card).toBeVisible();

  const before = await card.evaluate((el) => getComputedStyle(el).borderRadius);
  await page.evaluate(() => document.documentElement.style.setProperty("--radius-card", "40px"));
  const after = await card.evaluate((el) => getComputedStyle(el).borderRadius);

  expect(before).not.toBe(after);
  expect(after).toContain("40px");
});

test("Design & Branding preview pane renders a live sample of the brand", async ({ page }) => {
  await openCms(page);
  await page.getByText("Site Pages", { exact: false }).first().click();
  await page.getByText("Design & Branding", { exact: false }).first().click();

  // Decap renders previews inside an iframe.
  const preview = page.frameLocator("iframe").first();

  await expect(preview.locator(".tfp-preview-note")).toContainText(/live preview/i);
  await expect(preview.locator(".hero-gradient")).toBeVisible();
  await expect(preview.locator(".card").first()).toBeVisible();
  await expect(preview.getByText("Your palette")).toBeVisible();
});
