import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GEOHIDE_HOSTS_LIST, MALW_HOSTS_LIST } from "@/domain/toggles";
import { AdGuardStore } from "./store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dnsconf-ag-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("AdGuardStore", () => {
  it("resolves all source domains (parent and subdomains), compresses only matching IPs, and keeps ETag stable across restarts", async () => {
    const cacheDir = await makeTempDir();
    const fetchText = vi.fn(async (url: string) => {
      if (url === GEOHIDE_HOSTS_LIST) {
        return {
          status: 200,
          etag: '"gh-1"',
          text: [
            "193.233.112.67 openai.com",
            "193.233.112.68 www.openai.com",
            "193.233.112.67 api.openai.com",
            "193.233.112.67 google.com",
            "193.233.112.67 gemini.google.com",
            "0.0.0.0 blocked.example"
          ].join("\n")
        };
      }
      if (url === MALW_HOSTS_LIST) {
        return {
          status: 200,
          etag: '"mw-1"',
          text: "48.102.233.174 claude.ai\n48.102.233.174 instagram.com\n"
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const resolveBatch = vi.fn(async (_url: string, domains: readonly string[]) => {
      const records = new Map<string, string[]>();
      for (const domain of domains) {
        if (domain === "instagram.com") {
          records.set(domain, []); // e.g., donor returned 0.0.0.0 or NXDOMAIN
        } else if (domain === "gemini.google.com") {
          // Different IP from google.com -> must NOT be merged into google.com
          records.set(domain, ["198.51.100.77"]);
        } else {
          records.set(domain, ["198.51.100.20", "198.51.100.10"]);
        }
      }
      return { records, succeeded: domains.length, failed: 0, aborted: false };
    });

    const store1 = new AdGuardStore({
      cacheDir,
      fetchText,
      resolveBatch,
      now: () => new Date("2026-11-24T18:00:00.000Z")
    });

    const res1 = await store1.compileForDonor(
      "geohide-eu",
      { sources: ["geohide", "malw"], exclude: [], mode: "sub", compress: true, maxIps: 4 },
      "https://example.com"
    );

    expect(res1.ok).toBe(true);
    if (!res1.ok) return;

    // Every unique source domain (including subdomains and www.) was verified against the donor.
    expect(resolveBatch).toHaveBeenCalledTimes(1);
    const queried = [...resolveBatch.mock.calls[0][1]].sort();
    expect(queried).toEqual([
      "api.openai.com",
      "claude.ai",
      "gemini.google.com",
      "google.com",
      "instagram.com",
      "openai.com",
      "www.openai.com"
    ]);

    // Matching subdomains (api.openai.com, www.openai.com) collapsed into ||openai.com^
    expect(res1.compiled.text).toContain("||openai.com^$dnsrewrite=198.51.100.10\n");
    expect(res1.compiled.text).not.toContain("api.openai.com");
    expect(res1.compiled.text).not.toContain("www.openai.com");

    // Different-IP subdomain (gemini.google.com) stayed separate with denyallow on google.com
    expect(res1.compiled.text).toContain("||google.com^$dnsrewrite=198.51.100.10,denyallow=gemini.google.com\n");
    expect(res1.compiled.text).toContain("||gemini.google.com^$dnsrewrite=198.51.100.77\n");

    // instagram.com returned empty so it is omitted
    expect(res1.compiled.text).not.toContain("instagram.com");

    // Cold restart loads persisted snapshot from disk with zero network calls and identical ETag.
    const fetchText2 = vi.fn();
    const resolveBatch2 = vi.fn();
    const store2 = new AdGuardStore({
      cacheDir,
      fetchText: fetchText2,
      resolveBatch: resolveBatch2,
      now: () => new Date("2026-11-24T18:05:00.000Z")
    });

    const res2 = await store2.compileForDonor(
      "geohide-eu",
      { sources: ["geohide", "malw"], exclude: [], mode: "sub", compress: true, maxIps: 4 },
      "https://example.com"
    );
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(res2.compiled.etag).toBe(res1.compiled.etag);
    expect(fetchText2).not.toHaveBeenCalled();
    expect(resolveBatch2).not.toHaveBeenCalled();
  });

  it("does not enter an SWR refresh loop after 2 hours when donor IPs remain unchanged", async () => {
    const cacheDir = await makeTempDir();
    let currentTime = Date.parse("2026-11-24T18:00:00.000Z");

    const fetchText = vi.fn(async () => ({
      status: 200,
      etag: '"v1"',
      text: "198.51.100.1 chatgpt.com\n"
    }));
    const resolveBatch = vi.fn(async (_url: string, domains: readonly string[]) => {
      const records = new Map<string, string[]>();
      for (const domain of domains) records.set(domain, ["198.51.100.10"]);
      return { records, succeeded: domains.length, failed: 0, aborted: false };
    });

    const store = new AdGuardStore({
      cacheDir,
      refreshIntervalMs: 2 * 60 * 60 * 1000,
      fetchText,
      resolveBatch,
      now: () => new Date(currentTime)
    });

    const opts = { sources: ["geohide"] as ("geohide" | "malw")[], exclude: [], mode: "sub" as const, compress: true, maxIps: 4 };
    const first = await store.compileForDonor("comss", opts, "https://example.com");
    expect(first.ok).toBe(true);
    expect(resolveBatch).toHaveBeenCalledTimes(1);

    // Advance 2h 5m: next request triggers one background SWR refresh, which finds identical IPs.
    currentTime += 2 * 60 * 60 * 1000 + 5 * 60 * 1000;
    const second = await store.compileForDonor("comss", opts, "https://example.com");
    expect(second.ok).toBe(true);
    // Allow background SWR promise to complete
    await new Promise((r) => setTimeout(r, 20));
    expect(resolveBatch).toHaveBeenCalledTimes(2);

    // 1 minute later: checkedAt was updated, so subsequent requests MUST NOT re-trigger SWR,
    // while updatedAt and ETag remain identical to the first compile.
    currentTime += 60 * 1000;
    const third = await store.compileForDonor("comss", opts, "https://example.com");
    await new Promise((r) => setTimeout(r, 20));
    expect(resolveBatch).toHaveBeenCalledTimes(2);
    expect(third.ok).toBe(true);
    if (first.ok && third.ok) {
      expect(third.updatedAt).toBe(first.updatedAt);
      expect(third.compiled.etag).toBe(first.compiled.etag);
    }
  });

  it("applies negative-cache cooldown when a donor is unreachable instead of hammering it on every request", async () => {
    const cacheDir = await makeTempDir();
    let currentTime = Date.parse("2026-11-24T18:00:00.000Z");
    const resolveBatch = vi.fn(async () => ({ records: new Map(), succeeded: 0, failed: 1, aborted: true }));

    const store = new AdGuardStore({
      cacheDir,
      errorRetryCooldownMs: 5 * 60 * 1000,
      fetchText: async () => ({ status: 200, etag: null, text: "198.51.100.1 chatgpt.com\n" }),
      resolveBatch,
      now: () => new Date(currentTime)
    });

    const opts = { sources: ["geohide"] as ("geohide" | "malw")[], exclude: [], mode: "sub" as const, compress: true, maxIps: 4 };
    const res1 = await store.compileForDonor("dns-ai", opts, "https://example.com");
    expect(res1.ok).toBe(false);
    if (!res1.ok) expect(res1.status).toBe(503);
    expect(resolveBatch).toHaveBeenCalledTimes(1);

    // 1 minute later (within cooldown): returns 503 immediately without another DoH attempt.
    currentTime += 60 * 1000;
    const res2 = await store.compileForDonor("dns-ai", opts, "https://example.com");
    expect(res2.ok).toBe(false);
    expect(resolveBatch).toHaveBeenCalledTimes(1);

    // After cooldown expires: retries once.
    currentTime += 5 * 60 * 1000;
    await store.compileForDonor("dns-ai", opts, "https://example.com");
    expect(resolveBatch).toHaveBeenCalledTimes(2);
  });

  it("handles apex with empty A/NXDOMAIN cleanly while keeping resolved child subdomains", async () => {
    const cacheDir = await makeTempDir();
    const resolveBatch = vi.fn(async (_url: string, domains: readonly string[]) => {
      const records = new Map<string, string[]>();
      for (const domain of domains) {
        if (domain === "xboxlive.com") {
          records.set(domain, []);
        } else if (domain === "auth.xboxlive.com") {
          records.set(domain, ["198.51.100.77"]);
        }
      }
      return { records, succeeded: domains.length, failed: 0, aborted: false };
    });

    const store = new AdGuardStore({
      cacheDir,
      fetchText: async () => ({
        status: 200,
        etag: null,
        text: "198.51.100.1 xboxlive.com\n198.51.100.1 auth.xboxlive.com\n"
      }),
      resolveBatch
    });

    const res = await store.compileForDonor(
      "comss",
      { sources: ["geohide"], exclude: [], mode: "sub", compress: true, maxIps: 4 },
      "https://example.com"
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(resolveBatch).toHaveBeenCalledTimes(1);
    expect(res.compiled.text).toContain("||auth.xboxlive.com^$dnsrewrite=198.51.100.77\n");
    expect(res.compiled.text).not.toContain("||xboxlive.com^");
  });

  it("awaits the same disk read across concurrent ensureLoaded calls", async () => {
    const cacheDir = await makeTempDir();
    const snapshot = {
      version: 1,
      sources: {
        geohide: {
          id: "geohide",
          url: GEOHIDE_HOSTS_LIST,
          etag: '"gh-1"',
          updatedAt: "2026-11-24T18:00:00.000Z",
          entries: [{ domain: "chatgpt.com", ips: ["198.51.100.1"] }]
        }
      },
      donors: {
        comss: {
          slug: "comss",
          updatedAt: "2026-11-24T18:00:00.000Z",
          checkedAt: "2026-11-24T18:00:00.000Z",
          status: "ok",
          resolvedCount: 1,
          failedCount: 0,
          records: { "chatgpt.com": ["198.51.100.55"] }
        }
      }
    };
    await fs.writeFile(path.join(cacheDir, "snapshot.json"), JSON.stringify(snapshot), "utf8");

    const fetchText = vi.fn();
    const resolveBatch = vi.fn();
    const store = new AdGuardStore({
      cacheDir,
      fetchText,
      resolveBatch,
      now: () => new Date("2026-11-24T18:05:00.000Z")
    });

    const opts = { sources: ["geohide"] as ("geohide" | "malw")[], exclude: [], mode: "sub" as const, compress: true, maxIps: 4 };
    const [a, b] = await Promise.all([
      store.compileForDonor("comss", opts, "https://example.com"),
      store.compileForDonor("comss", opts, "https://example.com")
    ]);

    expect(a.ok && b.ok).toBe(true);
    expect(fetchText).not.toHaveBeenCalled();
    expect(resolveBatch).not.toHaveBeenCalled();
  });
});
