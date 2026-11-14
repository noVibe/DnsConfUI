/**
 * Whether a request came from this app's own page rather than from another site.
 *
 * A cross-origin POST with a plain content type needs no preflight, so without this any page the user happens to
 * have open could change what this container holds. Browsers send `Sec-Fetch-Site` on every fetch - `same-origin`
 * for the app's own calls, `cross-site` or `same-site` for another page's - and callers that are not a browser,
 * such as curl, send none, so an absent header is allowed.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin";
}
