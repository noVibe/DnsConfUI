import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as requestCode } from "./code/route";
import { POST as requestToken } from "./token/route";

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
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = "client-id";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalClientId === undefined) delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    else process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = originalClientId;
  });

  it("reports a missing GitHub client ID", async () => {
    delete process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

    const response = await requestCode();

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
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
