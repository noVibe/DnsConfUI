/**
 * The GitHub OAuth App this container authorizes with, when someone has named one in the UI.
 *
 * In memory and for as long as the container runs, like the DNS proxies added through the monitor: the app keeps
 * nothing of the user's between runs, and an ID set here reaches every browser that opens the app instead of
 * being pasted into each one. Restarting the container forgets it and the app goes back to the one it ships with.
 *
 * Keeping it costs nothing: a client ID is public by design - it is part of every authorization request and is
 * visible in the browser - and the device flow uses no client secret. The GitHub token is still never stored
 * anywhere; it lives in the browser tab for as long as the tab does.
 */
let stored = "";

/** The stored client ID, or an empty string for "use the one the app ships with". */
export function getStoredGitHubClientId(): string {
  return stored;
}

/** Stores the client ID, or forgets it when given an empty string. */
export function setStoredGitHubClientId(value: string): void {
  stored = value;
}
