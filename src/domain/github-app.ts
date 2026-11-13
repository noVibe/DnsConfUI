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
 * than one belonging to the user. The UI warns about the shared app before
 * starting the device flow.
 */
export function isUsingBuiltInGitHubClientId(): boolean {
  return getGitHubClientId() === BUILT_IN_GITHUB_CLIENT_ID;
}
