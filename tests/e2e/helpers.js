// Shared helpers for the visual-editing e2e suite.

/**
 * Open the Decap admin UI and get past the login screen.
 *
 * With `local_backend` pointed at decap-server, Decap still renders a login
 * button — it just doesn't ask for credentials. Clicking it drops straight into
 * the CMS, which is what makes headless testing possible.
 */
async function openCms(page, { collection, entry } = {}) {
  const hash = collection && entry ? `#/collections/${collection}/entries/${entry}` : "";
  await page.goto(`/admin/${hash}`);

  // The CMS bundle is loaded from unpkg; give it room on a cold cache.
  const loginButton = page.getByRole("button", { name: /login/i });
  await loginButton.waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click();
  }

  // Once authenticated the app chrome renders a "Contents" nav or the editor itself.
  await page.waitForSelector('[class*="AppMainContainer"], [class*="EditorContainer"]', {
    timeout: 45_000,
  });
}

/** Resolve a CSS custom property from the live document. */
async function cssVar(page, name) {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name
  );
}

module.exports = { openCms, cssVar };
