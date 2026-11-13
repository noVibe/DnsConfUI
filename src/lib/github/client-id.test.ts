import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readGitHubClientIdOverride, writeGitHubClientIdOverride } from "./client-id";

const STORAGE_KEY = "dnsconf.github-client-id";

describe("the stored client ID", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("comes back as it was written", () => {
    writeGitHubClientIdOverride("Ov23liOwnAppClientId");

    expect(readGitHubClientIdOverride()).toBe("Ov23liOwnAppClientId");
  });

  it("is forgotten when written empty", () => {
    writeGitHubClientIdOverride("Ov23liOwnAppClientId");
    writeGitHubClientIdOverride("");

    expect(readGitHubClientIdOverride()).toBe("");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("reads as nothing stored when the stored value is not a client ID", () => {
    // Anything could be under this key: another version of the app, or someone editing storage by hand.
    window.localStorage.setItem(STORAGE_KEY, "{}");

    expect(readGitHubClientIdOverride()).toBe("");
  });

  it("survives storage that throws, as a private window's does", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    expect(readGitHubClientIdOverride()).toBe("");
    expect(() => writeGitHubClientIdOverride("Ov23liOwnAppClientId")).not.toThrow();
  });
});
