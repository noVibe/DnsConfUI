import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILT_IN_GITHUB_CLIENT_ID,
  getGitHubClientId,
  isUsingBuiltInGitHubClientId,
} from "./github-app";

const originalClientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

describe("github-app", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  });

  afterEach(() => {
    if (originalClientId === undefined) delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    else process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = originalClientId;
  });

  it("ships a non-empty built-in client ID", () => {
    expect(BUILT_IN_GITHUB_CLIENT_ID).toBe("Ov23liyC26qJIXNHOjuD");
  });

  it("falls back to the built-in client ID when the env var is not set", () => {
    expect(getGitHubClientId()).toBe(BUILT_IN_GITHUB_CLIENT_ID);
    expect(isUsingBuiltInGitHubClientId()).toBe(true);
  });

  it("falls back to the built-in client ID when the env var is empty", () => {
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = "";

    expect(getGitHubClientId()).toBe(BUILT_IN_GITHUB_CLIENT_ID);
    expect(isUsingBuiltInGitHubClientId()).toBe(true);
  });

  it("falls back to the built-in client ID when the env var is only whitespace", () => {
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = "   ";

    expect(getGitHubClientId()).toBe(BUILT_IN_GITHUB_CLIENT_ID);
    expect(isUsingBuiltInGitHubClientId()).toBe(true);
  });

  it("prefers the configured client ID over the built-in one", () => {
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = "Ov23liOwnAppClientId";

    expect(getGitHubClientId()).toBe("Ov23liOwnAppClientId");
    expect(isUsingBuiltInGitHubClientId()).toBe(false);
  });

  it("trims surrounding whitespace from the configured client ID", () => {
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = "  Ov23liOwnAppClientId\n";

    expect(getGitHubClientId()).toBe("Ov23liOwnAppClientId");
  });
});
