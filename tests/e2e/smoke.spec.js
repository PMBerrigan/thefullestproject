const { test, expect } = require("@playwright/test");
const { cssVar } = require("./helpers");

/**
 * Baseline guarantees the visual-editing work must never break.
 * If these fail, something in the block model or theme pipeline regressed.
 */

test("homepage renders with compiled Tailwind and theme variables", async ({ page }) => {
  const failures = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && new URL(r.url()).host === "localhost:8080") {
      failures.push(`${r.status()} ${r.url()}`);
    }
  });

  await page.goto("/");

  await expect(page.locator("h1").first()).toBeVisible();

  // Tailwind actually compiled — a bare HTML page would have no computed padding here.
  const styled = await page.locator("section").first().evaluate((el) => getComputedStyle(el).paddingTop);
  expect(styled).not.toBe("0px");

  // theme.json reached the page as CSS custom properties.
  expect(await cssVar(page, "--color-primary")).toMatch(/#|rgb/);

  expect(failures, `broken local requests:\n${failures.join("\n")}`).toHaveLength(0);
});

test("core marketing pages return 200 and have a heading", async ({ page }) => {
  for (const path of ["/", "/about/", "/get-involved/", "/contact/", "/resources/"]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} status`).toBeLessThan(400);
    await expect(page.locator("h1").first(), `${path} h1`).toBeVisible();
  }
});

test("skip-nav and landmark roles survive refactors", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("a.skip-nav")).toHaveCount(1);
  await expect(page.locator('[role="banner"], header')).not.toHaveCount(0);
  await expect(page.locator('[role="contentinfo"], footer')).not.toHaveCount(0);
});
