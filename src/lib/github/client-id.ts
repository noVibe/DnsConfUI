import { isPlausibleGitHubClientId } from "@/domain/github-app";

/**
 * Where a client ID the user typed into the UI lives between page loads.
 *
 * It is kept at all because the alternative is retyping twenty characters after
 * every refresh, which is the inconvenience the field exists to remove. Keeping
 * it gives nothing away: a client ID is public by design - in any build that
 * configures one it is compiled into the browser bundle - and the device flow
 * uses no client secret. The GitHub token is still never stored anywhere; it
 * lives in memory for the life of the tab.
 */
const STORAGE_KEY = "dnsconf.github-client-id";

/**
 * The stored client ID, or an empty string for "use the one this build has".
 *
 * Browser storage throws in a private window and with site data blocked, and
 * can hand back anything a previous version wrote, so the panel must survive
 * both: a value that is not a client ID is treated as no value at all.
 */
export function readGitHubClientIdOverride(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored !== null && isPlausibleGitHubClientId(stored) ? stored : "";
  } catch {
    return "";
  }
}

/** Stores the client ID, or forgets it when given an empty string. */
export function writeGitHubClientIdOverride(value: string): void {
  try {
    if (value === "") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage being unavailable only costs the user the convenience: the ID
    // they typed still applies to this tab, it just will not survive a reload.
  }
}
