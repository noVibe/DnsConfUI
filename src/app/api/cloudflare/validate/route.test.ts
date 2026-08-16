import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const fetchMock = vi.fn();

function request(body: unknown) {
  return new Request("http://localhost/api/cloudflare/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/cloudflare/validate", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("rejects an invalid request body", async () => {
    const response = await POST(request({ clientId: "account" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with status 400", async () => {
    const response = await POST(new Request("http://localhost/api/cloudflare/validate", { method: "POST", body: "{" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unsuccessful token verification response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    const response = await POST(request({ clientId: "account", authSecret: "token" }));

    expect(await response.json()).toMatchObject({ valid: false, error: expect.stringContaining("Invalid Cloudflare API token") });
  });

  it("rejects a verification payload with success false", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) });

    const response = await POST(request({ clientId: "account", authSecret: "token" }));

    expect(await response.json()).toMatchObject({ valid: false, error: expect.stringContaining("Invalid Cloudflare API token") });
  });

  it("rejects an account ID that does not match the token", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: false });

    const response = await POST(request({ clientId: "wrong", authSecret: "token" }));

    expect(await response.json()).toMatchObject({ valid: false, error: expect.stringContaining("Account ID") });
  });

  it("validates both the token and account with bearer authentication", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({ ok: true });

    const response = await POST(request({ clientId: "account", authSecret: "token" }));

    await expect(response.json()).resolves.toEqual({ valid: true });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { Authorization: "Bearer token" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.cloudflare.com/client/v4/accounts/account", {
      headers: { Authorization: "Bearer token" },
    });
  });

  it("reports network failures", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const response = await POST(request({ clientId: "account", authSecret: "token" }));

    expect(await response.json()).toEqual({ valid: false, error: "Cannot reach Cloudflare API. Check your network connection." });
  });
});
