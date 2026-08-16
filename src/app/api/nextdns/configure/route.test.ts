import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_BLOCKLIST_IDS, NATIVE_TRACKING_IDS } from "@/domain/toggles";
import { POST } from "./route";

const fetchMock = vi.fn();

function request(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/nextdns/configure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: "abc123",
      authSecret: "secret",
      blockAds: false,
      nativeTracking: false,
      disguisedTrackers: false,
      ...overrides,
    }),
  });
}

describe("POST /api/nextdns/configure", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("rejects an invalid request body", async () => {
    const response = await POST(request({ nativeTracking: "yes" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with status 400", async () => {
    const response = await POST(new Request("http://localhost/api/nextdns/configure", { method: "POST", body: "{" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns success without upstream calls when every option is disabled", async () => {
    const response = await POST(request());

    await expect(response.json()).resolves.toEqual({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("patches disguised tracker privacy settings", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const response = await POST(request({ disguisedTrackers: true }));

    await expect(response.json()).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith("https://api.nextdns.io/profiles/abc123", expect.objectContaining({
      method: "PATCH",
      headers: { "X-Api-Key": "secret", "Content-Type": "application/json" },
      body: JSON.stringify({ privacy: { disguisedTrackers: true } }),
    }));
  });

  it("configures ad blocklists and security settings", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });

    const response = await POST(request({ blockAds: true }));

    await expect(response.json()).resolves.toEqual({ success: true });
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(options.body));
    expect(body.privacy.disguisedTrackers).toBe(false);
    expect(body.privacy.blocklists).toEqual(ADS_BLOCKLIST_IDS.map((id) => ({ id })));
    expect(body.security).toMatchObject({ threatIntelligenceFeeds: true, googleSafeBrowsing: true, dnsRebinding: true });
  });

  it("keeps disguised trackers enabled when both privacy options are selected", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await POST(request({ blockAds: true, disguisedTrackers: true }));

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body)).privacy.disguisedTrackers).toBe(true);
  });

  it("configures native tracking with a separate request", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const response = await POST(request({ nativeTracking: true }));

    await expect(response.json()).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith("https://api.nextdns.io/profiles/abc123/privacy/natives", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify(NATIVE_TRACKING_IDS.map((id) => ({ id }))),
    }));
  });

  it("stops and forwards the upstream error status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });

    const response = await POST(request({ disguisedTrackers: true, nativeTracking: true }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ success: false, error: "NextDNS API error (429): rate limited", status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses status 500 for network failures", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const response = await POST(request({ nativeTracking: true }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "offline" });
  });
});
