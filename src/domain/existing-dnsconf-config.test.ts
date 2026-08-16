import { describe, expect, it } from "vitest";
import { DEFAULT_DNS_DONOR } from "./dns-donors";
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

  it("uses the default donor for profiles missing a positional donor value", () => {
    const config = configFromDnsConfVariables({ DNS: "cloudflare,nextdns" });

    expect(config?.profiles.map((profile) => profile.donorDns)).toEqual([
      DEFAULT_DNS_DONOR,
      DEFAULT_DNS_DONOR
    ]);
  });

  it("rejects missing or unsupported DNS provider values", () => {
    expect(configFromDnsConfVariables({})).toBeNull();
    expect(configFromDnsConfVariables({ DNS: "cloudflare,unknown" })).toBeNull();
  });
});
