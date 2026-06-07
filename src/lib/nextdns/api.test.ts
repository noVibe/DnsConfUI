import { describe, expect, it, vi, beforeEach } from "vitest";
import { validateCredentials, configureNextDNSProfile } from "./api";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("validateCredentials", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns valid:true for successful validation", async () => {
    mockFetch.mockResolvedValue({ json: async () => ({ valid: true }) });

    const result = await validateCredentials("client", "secret", "nextdns");
    expect(result).toEqual({ valid: true });
    expect(mockFetch).toHaveBeenCalledWith("/api/nextdns/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "client", authSecret: "secret" })
    });
  });

  it("returns valid:false when validation fails", async () => {
    mockFetch.mockResolvedValue({ json: async () => ({ valid: false, error: "bad credentials" }) });

    const result = await validateCredentials("client", "wrong", "nextdns");
    expect(result).toEqual({ valid: false, error: "bad credentials" });
  });

  it("uses cloudflare endpoint for cloudflare provider", async () => {
    mockFetch.mockResolvedValue({ json: async () => ({ valid: true }) });

    await validateCredentials("client", "secret", "cloudflare");
    expect(mockFetch).toHaveBeenCalledWith("/api/cloudflare/validate", expect.anything());
  });

  it("returns network error when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const result = await validateCredentials("client", "secret", "nextdns");
    expect(result).toEqual({ valid: false, error: "Failed to reach validation endpoint." });
  });
});

describe("configureNextDNSProfile", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns success:true on successful configuration", async () => {
    mockFetch.mockResolvedValue({ json: async () => ({ success: true }) });

    const result = await configureNextDNSProfile("client", "secret", true, false, true);
    expect(result).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledWith("/api/nextdns/configure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "client", authSecret: "secret",
        blockAds: true, nativeTracking: false, disguisedTrackers: true
      })
    });
  });

  it("returns error when API returns success:false with a message", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 400, json: async () => ({ success: false, error: "invalid config" }) });

    const result = await configureNextDNSProfile("client", "secret", false, false, false);
    expect(result).toEqual({ success: false, error: "invalid config", status: 400 });
  });

  it("returns default error when API returns success:false without a message", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 500, json: async () => ({ success: false }) });

    const result = await configureNextDNSProfile("client", "secret", false, false, false);
    expect(result).toEqual({ success: false, error: "NextDNS configuration failed.", status: 500 });
  });

  it("returns network error when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const result = await configureNextDNSProfile("client", "secret", false, false, false);
    expect(result).toEqual({ success: false, error: "Connection refused" });
  });

  it("returns generic error when non-Error is thrown", async () => {
    mockFetch.mockRejectedValue("string error");

    const result = await configureNextDNSProfile("client", "secret", false, false, false);
    expect(result).toEqual({ success: false, error: "Failed to reach NextDNS configuration endpoint." });
  });
});
