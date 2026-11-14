import { beforeEach, describe, expect, it } from "vitest";
import { getStoredGitHubClientId, setStoredGitHubClientId } from "./client-id";

describe("the client ID this container holds", () => {
  beforeEach(() => {
    setStoredGitHubClientId("");
  });

  it("is nothing until one is set, which means the app's own", () => {
    expect(getStoredGitHubClientId()).toBe("");
  });

  it("comes back as it was set", () => {
    setStoredGitHubClientId("Ov23liOwnAppClientId");

    expect(getStoredGitHubClientId()).toBe("Ov23liOwnAppClientId");
  });

  it("is forgotten when set empty", () => {
    setStoredGitHubClientId("Ov23liOwnAppClientId");
    setStoredGitHubClientId("");

    expect(getStoredGitHubClientId()).toBe("");
  });
});
