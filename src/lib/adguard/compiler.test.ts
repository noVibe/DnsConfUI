import { describe, expect, it } from "vitest";
import { compileAdGuardFilter } from "./compiler";

const BASE = {
  title: "DnsConf AdGuard (GeoHide EU)",
  description: "Test list",
  homepage: "https://example.com/adguard",
  updatedAt: "2026-11-24T18:00:00.000Z"
};

describe("compileAdGuardFilter", () => {
  it("compresses subdomains (including www.) only when their IP sets match the parent and caps IPs to maxIps", () => {
    const result = compileAdGuardFilter({
      ...BASE,
      entries: [
        { domain: "openai.com", ips: ["198.51.100.1", "198.51.100.2", "198.51.100.1", "198.51.100.3", "198.51.100.4", "198.51.100.5"] },
        { domain: "api.openai.com", ips: ["198.51.100.4", "198.51.100.2", "198.51.100.3", "198.51.100.1"] },
        { domain: "www.openai.com", ips: ["198.51.100.1", "198.51.100.2", "198.51.100.3", "198.51.100.4"] }
      ],
      options: { sources: ["geohide"], exclude: [], mode: "sub", compress: true, maxIps: 4 }
    });

    expect(result.compressedDomainsCount).toBe(1);
    expect(result.rulesCount).toBe(4);
    expect(result.text).toContain("||openai.com^$dnsrewrite=198.51.100.1\n");
    expect(result.text).toContain("||openai.com^$dnsrewrite=198.51.100.4\n");
    expect(result.text).not.toContain("198.51.100.5");
    expect(result.text).not.toContain("api.openai.com");
    expect(result.text).not.toContain("www.openai.com");
    expect(result.text).not.toContain("\r");
  });

  it("keeps www. separate when it has different IPs or when apex is absent (and respects www. exclusions)", () => {
    const result = compileAdGuardFilter({
      ...BASE,
      entries: [
        { domain: "openai.com", ips: ["198.51.100.10"] },
        { domain: "www.openai.com", ips: ["198.51.100.99"] },
        { domain: "www.only.example", ips: ["198.51.100.50"] },
        { domain: "www.skip.example", ips: ["198.51.100.60"] }
      ],
      options: { sources: ["geohide"], exclude: ["www.skip.example"], mode: "sub", compress: true, maxIps: 4 }
    });

    expect(result.text).toContain("||openai.com^$dnsrewrite=198.51.100.10,denyallow=www.openai.com\n");
    expect(result.text).toContain("||www.openai.com^$dnsrewrite=198.51.100.99\n");
    expect(result.text).toContain("||www.only.example^$dnsrewrite=198.51.100.50\n");
    expect(result.text).not.toContain("||only.example^");
    expect(result.text).not.toContain("skip.example");
  });

  it("carves out subdomains with different proxy IPs using $denyallow so IPs never mix", () => {
    const result = compileAdGuardFilter({
      ...BASE,
      entries: [
        { domain: "google.com", ips: ["198.51.100.10", "198.51.100.11"] },
        { domain: "gemini.google.com", ips: ["198.51.100.20"] },
        { domain: "deep.gemini.google.com", ips: ["198.51.100.20"] }
      ],
      options: { sources: ["geohide"], exclude: [], mode: "sub", compress: true, maxIps: 4 }
    });

    expect(result.rulesCount).toBe(3);
    expect(result.text).toContain("||gemini.google.com^$dnsrewrite=198.51.100.20\n");
    expect(result.text).toContain("||google.com^$dnsrewrite=198.51.100.10,denyallow=gemini.google.com\n");
    expect(result.text).toContain("||google.com^$dnsrewrite=198.51.100.11,denyallow=gemini.google.com\n");
    expect(result.text).not.toContain("deep.gemini.google.com");
  });

  it("handles user exclusions both for top-level domains and subdomains under a kept parent", () => {
    const result = compileAdGuardFilter({
      ...BASE,
      entries: [
        { domain: "instagram.com", ips: ["198.51.100.10"] },
        { domain: "cdn.instagram.com", ips: ["198.51.100.10"] },
        { domain: "example.com", ips: ["198.51.100.20"] },
        { domain: "direct.example.com", ips: ["198.51.100.20"] }
      ],
      options: {
        sources: ["geohide"],
        exclude: ["instagram.com", "direct.example.com"],
        mode: "sub",
        compress: true,
        maxIps: 4
      }
    });

    expect(result.rulesCount).toBe(1);
    expect(result.text).not.toContain("instagram.com");
    expect(result.text).toContain("||example.com^$dnsrewrite=198.51.100.20,denyallow=direct.example.com\n");
  });

  it("supports exact-match mode preserving www subdomains", () => {
    const result = compileAdGuardFilter({
      ...BASE,
      entries: [
        { domain: "example.com", ips: ["198.51.100.10"] },
        { domain: "www.example.com", ips: ["198.51.100.10"] }
      ],
      options: { sources: ["geohide"], exclude: [], mode: "exact", compress: true, maxIps: 1 }
    });

    expect(result.rulesCount).toBe(2);
    expect(result.text).toContain("|example.com^$dnsrewrite=198.51.100.10\n");
    expect(result.text).toContain("|www.example.com^$dnsrewrite=198.51.100.10\n");
  });

  it("never emits self-cancelling @@ exceptions when compress=false exceeds the line length cap", () => {
    const subs = Array.from({ length: 45 }, (_, i) => ({
      domain: `subdomain-with-long-name-${i}.example.com`,
      ips: ["198.51.100.10"]
    }));
    const result = compileAdGuardFilter({
      ...BASE,
      entries: [{ domain: "example.com", ips: ["198.51.100.10"] }, ...subs],
      options: {
        sources: ["geohide"],
        exclude: ["direct.subdomain-with-long-name-0.example.com"],
        mode: "sub",
        compress: false,
        maxIps: 1
      }
    });

    // Same-IP children collapse into parent instead of emitting @@||sub^$dnsrewrite=198.51.100.10,
    // while user exclusions beneath collapsed children are preserved on the parent.
    expect(result.text).toContain("||example.com^$dnsrewrite=198.51.100.10,denyallow=direct.subdomain-with-long-name-0.example.com\n");
    expect(result.text).not.toContain("@@||subdomain-with-long-name-");
    for (const line of result.text.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(900);
    }
  });

  it("falls back to @@ exceptions cleanly for long different-IP carve-outs without cancelling shared IPs", () => {
    const subs = Array.from({ length: 45 }, (_, i) => ({
      domain: `subdomain-with-long-name-${i}.example.com`,
      // Shares 198.51.100.10 with parent and adds 198.51.100.20 (partial overlap)
      ips: i === 0 ? ["198.51.100.10", "198.51.100.20"] : ["198.51.100.20"]
    }));
    const result = compileAdGuardFilter({
      ...BASE,
      entries: [{ domain: "example.com", ips: ["198.51.100.10", "198.51.100.11"] }, ...subs],
      options: { sources: ["geohide"], exclude: [], mode: "sub", compress: true, maxIps: 2 }
    });

    expect(result.text).toContain("||example.com^$dnsrewrite=198.51.100.10\n");
    expect(result.text).toContain("||example.com^$dnsrewrite=198.51.100.11\n");
    // Child 0 shares 198.51.100.10 with parent: must NOT cancel 198.51.100.10, must cancel 198.51.100.11, and emit 198.51.100.20
    expect(result.text).not.toContain("@@||subdomain-with-long-name-0.example.com^$dnsrewrite=198.51.100.10\n");
    expect(result.text).toContain("@@||subdomain-with-long-name-0.example.com^$dnsrewrite=198.51.100.11\n");
    expect(result.text).not.toContain("||subdomain-with-long-name-0.example.com^$dnsrewrite=198.51.100.10\n");
    expect(result.text).toContain("||subdomain-with-long-name-0.example.com^$dnsrewrite=198.51.100.20\n");
    // Child 1 is disjoint from parent: cancels both parent IPs and emits its own IP
    expect(result.text).toContain("@@||subdomain-with-long-name-1.example.com^$dnsrewrite=198.51.100.10\n");
    expect(result.text).toContain("@@||subdomain-with-long-name-1.example.com^$dnsrewrite=198.51.100.11\n");
    expect(result.text).toContain("||subdomain-with-long-name-1.example.com^$dnsrewrite=198.51.100.20\n");
    for (const line of result.text.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(900);
    }
  });

  it("never emits non-public IPs and produces ETags stable across different request homepages", () => {
    const common = {
      ...BASE,
      entries: [
        { domain: "bad.example", ips: ["0.0.0.0", "127.0.0.1"] },
        { domain: "good.example", ips: ["198.51.100.30"] }
      ],
      options: { sources: ["geohide"] as ("geohide" | "malw")[], exclude: [], mode: "sub" as const, compress: true, maxIps: 4 }
    };
    const a = compileAdGuardFilter({ ...common, homepage: "https://a.example/adguard" });
    const b = compileAdGuardFilter({ ...common, homepage: "https://b.example/adguard" });

    expect(a.rulesCount).toBe(1);
    expect(a.etag).toBe(b.etag);
    expect(a.text).not.toContain("bad.example");
  });
});
