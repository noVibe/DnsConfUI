import { describe, expect, it } from "vitest";
import { configFromDnsConfVariables } from "./existing-dnsconf-config";

describe("configFromDnsConfVariables", () => {
  it("restores profile order, providers, donors, and source variables", () => {
    expect(configFromDnsConfVariables({
      DNS: "nextdns,cloudflare",
      DONOR_DNS: "-,https://xbox-dns.ru/dns-query",
      BLOCK: "https://example.com/block-a,https://example.com/block-b",
      REDIRECT: "https://example.com/redirect",
      EXCLUDE_REDIRECT: "keep.example,another.example"
    })).toEqual({
      profiles: [
        { clientId: "", authSecret: "", provider: "nextdns", donorDns: "" },
        { clientId: "", authSecret: "", provider: "cloudflare", donorDns: "https://xbox-dns.ru/dns-query" }
      ],
      blocklists: ["https://example.com/block-a", "https://example.com/block-b"],
      redirects: ["https://example.com/redirect"],
      redirectExclusions: ["keep.example", "another.example"]
    });
  });

  it("disables donors when DONOR_DNS is absent", () => {
    const config = configFromDnsConfVariables({ DNS: "cloudflare,nextdns" });

    expect(config?.profiles.map((profile) => profile.donorDns)).toEqual(["", ""]);
  });

  it("disables profiles missing a positional donor value", () => {
    const config = configFromDnsConfVariables({
      DNS: "cloudflare,nextdns",
      DONOR_DNS: "https://xbox-dns.ru/dns-query"
    });

    expect(config?.profiles.map((profile) => profile.donorDns)).toEqual([
      "https://xbox-dns.ru/dns-query",
      ""
    ]);
  });

  it("restores source variables separated by whitespace or commas", () => {
    const config = configFromDnsConfVariables({
      DNS: "cloudflare",
      BLOCK: "https://example.com/block-a\nhttps://example.com/block-b https://example.com/block-c",
      REDIRECT: "https://example.com/redirect-a,\nhttps://example.com/redirect-b",
      EXCLUDE_REDIRECT: "keep.example another.example"
    });

    expect(config?.blocklists).toEqual([
      "https://example.com/block-a",
      "https://example.com/block-b",
      "https://example.com/block-c"
    ]);
    expect(config?.redirects).toEqual([
      "https://example.com/redirect-a",
      "https://example.com/redirect-b"
    ]);
    expect(config?.redirectExclusions).toEqual(["keep.example", "another.example"]);
  });

  it("rejects missing or unsupported DNS provider values", () => {
    expect(configFromDnsConfVariables({})).toBeNull();
    expect(configFromDnsConfVariables({ DNS: "cloudflare,unknown" })).toBeNull();
  });
});
