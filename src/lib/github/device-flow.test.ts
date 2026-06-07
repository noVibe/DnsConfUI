import { describe, expect, it, vi, beforeEach } from "vitest";
import { requestGitHubDeviceCode, pollGitHubDeviceToken, readError } from "./device-flow";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("readError", () => {
  it("extracts message field from JSON response", async () => {
    const res = { json: async () => ({ message: "not found" }) } as unknown as Response;
    expect(await readError(res, "fallback")).toBe("not found");
  });

  it("falls back to error field when message is absent", async () => {
    const res = { json: async () => ({ error: "bad_request" }) } as unknown as Response;
    expect(await readError(res, "fallback")).toBe("bad_request");
  });

  it("uses fallback when JSON is unparseable", async () => {
    const res = { json: async () => { throw new Error("invalid json"); } } as unknown as Response;
    expect(await readError(res, "fallback text")).toBe("fallback text");
  });

  it("uses fallback when both message and error are missing", async () => {
    const res = { json: async () => ({}) } as unknown as Response;
    expect(await readError(res, "fallback")).toBe("fallback");
  });
});

describe("requestGitHubDeviceCode", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns parsed device code on success", async () => {
    const deviceCode = {
      device_code: "dc",
      user_code: "uc",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5
    };
    mockFetch.mockResolvedValue({ ok: true, json: async () => deviceCode });

    const result = await requestGitHubDeviceCode();
    expect(result).toEqual(deviceCode);
    expect(mockFetch).toHaveBeenCalledWith("/api/github/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" }
    });
  });

  it("throws when response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "device_code" })
    });

    await expect(requestGitHubDeviceCode()).rejects.toThrow("device_code");
  });

  it("uses fallback message when error response has no details", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({})
    });

    await expect(requestGitHubDeviceCode()).rejects.toThrow("Unable to start GitHub device authorization.");
  });
});

describe("pollGitHubDeviceToken", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns access token on success", async () => {
    const tokenResponse = { access_token: "abc", token_type: "bearer", scope: "repo" };
    mockFetch.mockResolvedValue({ ok: true, json: async () => tokenResponse });

    const result = await pollGitHubDeviceToken("dc123");
    expect(result).toEqual(tokenResponse);
    expect(mockFetch).toHaveBeenCalledWith("/api/github/device/token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: "dc123" })
    });
  });

  it("returns device flow error on non-ok response", async () => {
    const errorResponse = { error: "authorization_pending" };
    mockFetch.mockResolvedValue({ ok: false, json: async () => errorResponse });

    await expect(pollGitHubDeviceToken("dc123")).rejects.toThrow("authorization_pending");
  });

  it("uses fallback message on generic failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(pollGitHubDeviceToken("dc123")).rejects.toThrow("Unable to poll GitHub device authorization.");
  });
});
