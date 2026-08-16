import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const fetchMock = vi.fn();

function request(body: unknown) {
  return new Request("http://localhost/api/nextdns/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/nextdns/validate", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("rejects an invalid request body", async () => {
    const response = await POST(request({ clientId: "", authSecret: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ valid: false, error: "Invalid request body." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with status 400", async () => {
    const response = await POST(new Request("http://localhost/api/nextdns/validate", { method: "POST", body: "{" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates credentials with the expected NextDNS headers", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const response = await POST(request({ clientId: "abc123", authSecret: "secret" }));

    await expect(response.json()).resolves.toEqual({ valid: true });
    expect(fetchMock).toHaveBeenCalledWith("https://api.nextdns.io/profiles/abc123", {
      headers: { "X-Api-Key": "secret" },
    });
  });

  it.each([401, 403])("reports invalid credentials for status %s", async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status });

    const response = await POST(request({ clientId: "abc123", authSecret: "bad" }));

    expect(await response.json()).toMatchObject({ valid: false, error: expect.stringContaining("Invalid NextDNS credentials") });
  });

  it("reports a missing profile", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const response = await POST(request({ clientId: "abc123", authSecret: "secret" }));

    expect(await response.json()).toEqual({ valid: false, error: "Profile not found. Check your CLIENT_ID." });
  });

  it("preserves an unexpected upstream status in the error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });

    const response = await POST(request({ clientId: "abc123", authSecret: "secret" }));

    expect(await response.json()).toEqual({ valid: false, error: "NextDNS API returned 429." });
  });

  it("reports network failures", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const response = await POST(request({ clientId: "abc123", authSecret: "secret" }));

    expect(await response.json()).toEqual({ valid: false, error: "Cannot reach NextDNS API. Check your network connection." });
  });
});
