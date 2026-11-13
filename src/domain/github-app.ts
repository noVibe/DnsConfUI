/**
 * The project owner's GitHub OAuth App, shipped with the app so that an end
 * user does not have to register an OAuth App of their own before signing in.
 *
 * A client ID is a public value by design: it is part of every authorization
 * request and the device flow uses no client secret at all, so there is
 * nothing here that could leak. Setting NEXT_PUBLIC_GITHUB_CLIENT_ID in the
 * environment overrides this value with the user's own app.
 */
export const BUILT_IN_GITHUB_CLIENT_ID = "Ov23liyC26qJIXNHOjuD";

/**
 * The client ID the app should authorize with: the configured one when it is
 * set and non-empty, otherwise the built-in default.
 */
export function getGitHubClientId(): string {
  // `process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID` is written out literally on
  // purpose. Next.js inlines NEXT_PUBLIC_* into the browser bundle by textual
  // substitution at build time, so destructuring process.env or indexing it
  // with a variable would silently produce `undefined` in the browser.
  const configured = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const trimmed = typeof configured === "string" ? configured.trim() : "";

  return trimmed.length > 0 ? trimmed : BUILT_IN_GITHUB_CLIENT_ID;
}

/**
 * Whether authorization goes through the project's shared OAuth App rather
 * than one belonging to the user. The UI says so before starting the device
 * flow, and offers a field for the user's own client ID.
 *
 * The argument is what the browser is actually authorizing with, which is not
 * always what this build was given: someone running the app locally can type
 * their own client ID into the UI instead of rebuilding the image with another
 * NEXT_PUBLIC_GITHUB_CLIENT_ID.
 */
export function isUsingBuiltInGitHubClientId(clientId: string = getGitHubClientId()): boolean {
  return clientId === BUILT_IN_GITHUB_CLIENT_ID;
}

/**
 * Whether a string could be a GitHub client ID at all.
 *
 * Deliberately a shape check and not a format check. GitHub has already
 * changed what a client ID looks like once (20 hex characters, then `Ov23li…`,
 * `Iv1.…` for GitHub Apps), so pinning the current spelling would reject a
 * valid ID the day it changes again. What this does rule out is a value that
 * cannot be a client ID in any format - an empty string, a pasted URL, a whole
 * `.env` line, anything with whitespace or control characters - so a typo is
 * caught in the field rather than by a confusing answer from GitHub.
 */
export function isPlausibleGitHubClientId(value: string): boolean {
  return /^[A-Za-z0-9._-]{10,100}$/.test(value);
}

/**
 * The client ID a device-flow request should be made with.
 *
 * The browser may supply one, because the UI lets the user authorize through
 * an OAuth App of their own without rebuilding anything. Nothing is lost by
 * trusting it: a client ID is public by design, the device flow has no client
 * secret, and the value only ever travels to GitHub's own endpoints as
 * `client_id`. A supplied value that is not a client ID at all returns `null`,
 * which the routes report as a bad request - quietly falling back to the
 * shared app would authorize against the wrong app and look like a GitHub
 * failure to whoever typed it.
 *
 * What this build was given is passed in rather than read here, so that
 * `getGitHubClientId` stays the only place that reads the environment.
 */
export function resolveGitHubClientId(supplied: unknown, configured: string): string | null {
  if (typeof supplied !== "string" || supplied.trim() === "") return configured;
  const trimmed = supplied.trim();
  return isPlausibleGitHubClientId(trimmed) ? trimmed : null;
}
