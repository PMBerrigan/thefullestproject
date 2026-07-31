/**
 * Sign-in for Edit Studio.
 *
 * Two keys. The GitHub token exists in this tab only long enough to be
 * exchanged for an edit session, then it is deleted from sessionStorage — so
 * the tab that frames the public site never holds a repo-scoped credential.
 * The edit session it gets back can do exactly one thing: replace text at an
 * allow-listed field on one of three pages, for two hours.
 *
 * The OAuth popup flow below is a deliberate copy of signIn()/acceptToken() in
 * src/admin/review/portal.js rather than a shared import. portal.js is a large
 * file that gates the approval pipeline; extracting a module from it to save
 * sixty lines is not worth the risk of disturbing it. If the OAuth worker URL
 * ever changes, change it in BOTH places.
 */

const OAUTH_URL = "https://decap-oauth.patrick-m-berrigan.workers.dev/auth?provider=github&scope=repo";
const OAUTH_ORIGIN = "https://decap-oauth.patrick-m-berrigan.workers.dev";
const GH_TOKEN_KEY = "tfpAdminToken";   // shared with the review portal
const SESSION_KEY = "tfpEditSession";
const ACTOR_KEY = "tfpEditActor";

export function getSession() {
  return sessionStorage.getItem(SESSION_KEY) || "";
}

export function getActor() {
  return sessionStorage.getItem(ACTOR_KEY) || "";
}

export function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(ACTOR_KEY);
}

/**
 * Swap a GitHub token for an edit session, then forget the GitHub token.
 * Returns { ok, actor, pages } or { error }.
 */
export async function exchange(workerUrl, githubToken) {
  let res;
  try {
    res = await fetch(workerUrl + "/inline-edit/session", {
      method: "POST",
      headers: { Authorization: "token " + githubToken },
    });
  } catch {
    return { error: "Could not reach the server. Check your connection and try again." };
  }

  let body = {};
  try { body = await res.json(); } catch { /* fall through to the status check */ }

  if (!res.ok) {
    return { error: body.error || "Sign-in failed (" + res.status + ")." };
  }

  sessionStorage.setItem(SESSION_KEY, body.session);
  sessionStorage.setItem(ACTOR_KEY, body.actor || "");
  // Deliberate: this is what keeps a repo-scope token out of the tab that
  // frames the public site. It also signs her out of the review portal, which
  // the UI says plainly.
  sessionStorage.removeItem(GH_TOKEN_KEY);

  return { ok: true, actor: body.actor, pages: body.pages };
}

/** Any GitHub token this tab already has, e.g. arriving from the review portal. */
export function existingGithubToken() {
  return sessionStorage.getItem(GH_TOKEN_KEY) || "";
}

/**
 * Open the GitHub OAuth popup. Calls back with a token, or with an error
 * string. Mirrors the review portal so the experience is the one she knows.
 */
export function signInWithPopup(onToken, onStatus) {
  const popup = window.open(OAUTH_URL, "tfp-oauth", "width=600,height=700");
  if (!popup) {
    onStatus("Popup blocked — allow popups for this site, or paste a personal access token below.");
    return;
  }
  onStatus("Opening GitHub… if nothing happens, allow popups for this site.");

  function onMessage(event) {
    if (event.origin !== OAUTH_ORIGIN) return;
    const data = typeof event.data === "string" ? event.data : "";
    if (data.indexOf("authorization:github:success:") !== 0) {
      if (data.indexOf("authorization:github:error:") === 0) {
        window.removeEventListener("message", onMessage);
        onStatus("Sign-in failed — try again, or use a personal access token.");
      }
      return;
    }
    window.removeEventListener("message", onMessage);
    try {
      const payload = JSON.parse(data.slice("authorization:github:success:".length));
      if (payload && payload.token) onToken(payload.token);
      else onStatus("No token received from GitHub.");
    } catch {
      onStatus("Could not read the sign-in response.");
    }
  }

  window.addEventListener("message", onMessage);
}
