import { describe, expect, it } from "vitest";
import {
  BUILT_IN_GITHUB_CLIENT_ID,
  isPlausibleGitHubClientId,
  isUsingBuiltInGitHubClientId,
  resolveGitHubClientId,
} from "./github-app";

describe("github-app", () => {
  it("ships a non-empty built-in client ID", () => {
    expect(BUILT_IN_GITHUB_CLIENT_ID).toBe("Ov23liyC26qJIXNHOjuD");
  });

  it("judges the app by the client ID it is given", () => {
    // What the panel authorizes with may be a client ID someone named in the UI, which this module never sees.
    expect(isUsingBuiltInGitHubClientId("Ov23liOwnAppClientId")).toBe(false);
    expect(isUsingBuiltInGitHubClientId(BUILT_IN_GITHUB_CLIENT_ID)).toBe(true);
    expect(isUsingBuiltInGitHubClientId()).toBe(true);
  });
});

describe("isPlausibleGitHubClientId", () => {
  it("accepts the shapes GitHub has used for client IDs", () => {
    expect(isPlausibleGitHubClientId(BUILT_IN_GITHUB_CLIENT_ID)).toBe(true);
    expect(isPlausibleGitHubClientId("Iv1.8a61f9b3a7aba766")).toBe(true);
    expect(isPlausibleGitHubClientId("1234567890abcdef1234")).toBe(true);
  });

  it("refuses what cannot be a client ID in any format", () => {
    expect(isPlausibleGitHubClientId("")).toBe(false);
    expect(isPlausibleGitHubClientId("Ov23li")).toBe(false);
    expect(isPlausibleGitHubClientId("Ov23li OwnAppClientId")).toBe(false);
    expect(isPlausibleGitHubClientId("NEXT_PUBLIC_GITHUB_CLIENT_ID=Ov23liOwnAppClientId")).toBe(false);
    expect(isPlausibleGitHubClientId("https://github.com/settings/developers")).toBe(false);
    expect(isPlausibleGitHubClientId(`Ov23li${"x".repeat(200)}`)).toBe(false);
  });
});

describe("resolveGitHubClientId", () => {
  it("prefers what the browser supplied over what the build has", () => {
    expect(resolveGitHubClientId("Ov23liOwnAppClientId", "client-id")).toBe("Ov23liOwnAppClientId");
  });

  it("trims the supplied value, as a paste carries whitespace", () => {
    expect(resolveGitHubClientId("  Ov23liOwnAppClientId  ", "client-id")).toBe("Ov23liOwnAppClientId");
  });

  it("falls back to the build's own for anything that is not a value at all", () => {
    expect(resolveGitHubClientId(undefined, "client-id")).toBe("client-id");
    expect(resolveGitHubClientId("", "client-id")).toBe("client-id");
    expect(resolveGitHubClientId("   ", "client-id")).toBe("client-id");
    expect(resolveGitHubClientId(42, "client-id")).toBe("client-id");
  });

  // Not a fallback: authorizing against an app the user did not ask for would surface as a GitHub error much
  // later, far from the field the typo was made in.
  it("refuses a supplied value that is not a client ID rather than replacing it", () => {
    expect(resolveGitHubClientId("not a client id", "client-id")).toBeNull();
  });
});
