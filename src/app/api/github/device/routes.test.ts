import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_GITHUB_CLIENT_ID } from "@/domain/github-app";
import { POST as requestCode } from "./code/route";
import { POST as requestToken } from "./token/route";

// `null` keeps the real, env-driven behaviour; a string forces that client ID,
// which is the only way to reach the "nothing configured at all" state now
// that a built-in client ID ships with the app.
const clientIdOverride = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("@/domain/github-app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/github-app")>();

  return {
    ...actual,
    getGitHubClientId: () =>
      clientIdOverride.value === null ? actual.getGitHubClientId() : clientIdOverride.value,
  };
});

const fetchMock = vi.fn();
const originalClientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

function tokenRequest(body: unknown) {
  return new Request("http://localhost/api/github/device/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GitHub device flow routes", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    clientIdOverride.value = null;
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = "client-id";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clientIdOverride.value = null;
    if (originalClientId === undefined) delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    else process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = originalClientId;
  });

  it("reports a missing GitHub client ID", async () => {
    clientIdOverride.value = "";

    const response = await requestCode();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ message: "GitHub client ID is not configured." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the built-in client ID when none is configured", async () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ device_code: "dc" }) });

    const response = await requestCode();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/device/code", expect.objectContaining({
      body: JSON.stringify({ client_id: BUILT_IN_GITHUB_CLIENT_ID, scope: "repo workflow read:user" }),
    }));
  });

  it("exchanges the device code with the built-in client ID when none is configured", async () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ access_token: "token" }) });

    const response = await requestToken(tokenRequest({ device_code: "dc" }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/oauth/access_token", expect.objectContaining({
      body: JSON.stringify({
        client_id: BUILT_IN_GITHUB_CLIENT_ID,
        device_code: "dc",
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    }));
  });

  it("requests a device code with the required scopes", async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ device_code: "dc" }) });

    const response = await requestCode();

    await expect(response.json()).resolves.toEqual({ device_code: "dc" });
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/device/code", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ client_id: "client-id", scope: "repo workflow read:user" }),
    }));
  });

  it("rejects an empty device code", async () => {
    const response = await requestToken(tokenRequest({ device_code: "" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed token JSON with status 400", async () => {
    const response = await requestToken(new Request("http://localhost/api/github/device/token", { method: "POST", body: "{" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the token request and upstream status", async () => {
    fetchMock.mockResolvedValue({ status: 202, json: async () => ({ error: "authorization_pending" }) });

    const response = await requestToken(tokenRequest({ device_code: "dc" }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ error: "authorization_pending" });
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/oauth/access_token", expect.objectContaining({
      body: JSON.stringify({
        client_id: "client-id",
        device_code: "dc",
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    }));
  });
});
