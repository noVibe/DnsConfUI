import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const storeMock = vi.hoisted(() => ({ compileForDonor: vi.fn() }));

vi.mock("@/lib/adguard/store", () => ({
  getAdGuardStore: () => storeMock
}));

function makeRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://dns.example${path}`, { headers });
}

describe("GET /adguard/[donor]", () => {
  beforeEach(() => {
    storeMock.compileForDonor.mockReset();
    delete process.env.APP_URL;
  });

  it("returns 404 with no-store for unknown donors", async () => {
    const response = await GET(makeRequest("/adguard/nonexistent"), {
      params: Promise.resolve({ donor: "nonexistent" })
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(storeMock.compileForDonor).not.toHaveBeenCalled();
  });

  it("returns 400 with no-store for invalid query parameters", async () => {
    const response = await GET(makeRequest("/adguard/geohide-eu?ips=99"), {
      params: Promise.resolve({ donor: "geohide-eu" })
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(storeMock.compileForDonor).not.toHaveBeenCalled();
  });

  it("serves plain-text AdGuard filter list for both /adguard/comss and /adguard/comss.txt and supports ETag 304", async () => {
    storeMock.compileForDonor.mockResolvedValue({
      ok: true,
      updatedAt: "2026-11-24T18:00:00.000Z",
      compiled: {
        text: "! Title: DnsConf AdGuard — Comss\n||chatgpt.com^$dnsrewrite=8.6.112.0\n",
        etag: '"abc123"',
        rulesCount: 1,
        domainsCount: 1,
        compressedDomainsCount: 1
      }
    });

    const response = await GET(makeRequest("/adguard/comss.txt"), {
      params: Promise.resolve({ donor: "comss.txt" })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect(response.headers.get("x-rules-count")).toBe("1");
    expect(await response.text()).toContain("||chatgpt.com^$dnsrewrite=8.6.112.0");

    const notModified = await GET(makeRequest("/adguard/comss", { "if-none-match": '"abc123"' }), {
      params: Promise.resolve({ donor: "comss" })
    });
    expect(notModified.status).toBe(304);
  });

  it("ignores invalid X-Forwarded-Host / X-Forwarded-Proto headers and prefers APP_URL when configured", async () => {
    storeMock.compileForDonor.mockResolvedValue({
      ok: true,
      updatedAt: "2026-11-24T18:00:00.000Z",
      compiled: { text: "", etag: '"e1"', rulesCount: 0, domainsCount: 0, compressedDomainsCount: 0 }
    });

    await GET(
      makeRequest("/adguard/comss", {
        "x-forwarded-host": "evil.com/path@bad",
        "x-forwarded-proto": "javascript"
      }),
      { params: Promise.resolve({ donor: "comss" }) }
    );
    expect(storeMock.compileForDonor).toHaveBeenLastCalledWith("comss", expect.anything(), "https://dns.example");

    process.env.APP_URL = "https://canonical.example/subpath";
    await GET(
      makeRequest("/adguard/comss", { "x-forwarded-host": "spoofed.example" }),
      { params: Promise.resolve({ donor: "comss" }) }
    );
    expect(storeMock.compileForDonor).toHaveBeenLastCalledWith("comss", expect.anything(), "https://canonical.example");
  });

  it("returns 503 with Retry-After and no-store when donor is unreachable", async () => {
    storeMock.compileForDonor.mockResolvedValue({
      ok: false,
      status: 503,
      error: "Donor unreachable"
    });

    const response = await GET(makeRequest("/adguard/dns-ai"), {
      params: Promise.resolve({ donor: "dns-ai" })
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("300");
  });
});
