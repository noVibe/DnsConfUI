import { describe, expect, it } from "vitest";
import { DEFAULT_DNS_DONOR } from "@/domain/dns-donors";
import { GEOHIDE_HOSTS_LIST, MALW_HOSTS_LIST, OISD_SMALL_BLOCK_DOMAINS } from "@/domain/toggles";
import { buildQuickDnsConfConfig, parseExcludeDomains } from "./setup-wizard";

describe("parseExcludeDomains", () => {
  it("splits by newline", () => {
    expect(parseExcludeDomains("a.com\nb.com\nc.com")).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("splits by comma without space", () => {
    expect(parseExcludeDomains("a.com,b.com,c.com")).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("splits by comma with space", () => {
    expect(parseExcludeDomains("a.com, b.com, c.com")).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("splits by space", () => {
    expect(parseExcludeDomains("a.com b.com c.com")).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("handles mixed delimiters", () => {
    expect(parseExcludeDomains("a.com b.com\nc.com,d.com")).toEqual(["a.com", "b.com", "c.com", "d.com"]);
  });

  it("removes empty entries", () => {
    expect(parseExcludeDomains("a.com,,b.com\n\nc.com")).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("trims whitespace from entries", () => {
    expect(parseExcludeDomains("  a.com  ,  b.com  ")).toEqual(["a.com", "b.com"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseExcludeDomains("")).toEqual([]);
  });

  it("returns empty array for whitespace only", () => {
    expect(parseExcludeDomains("   \n  ,  ")).toEqual([]);
  });

  it("splits by semicolon", () => {
    expect(parseExcludeDomains("a.com;b.com;c.com")).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("splits by slash", () => {
    expect(parseExcludeDomains("a.com/b.com/c.com")).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("splits by mixed delimiters including semicolon and slash", () => {
    expect(parseExcludeDomains("a.com;b.com/c.com d.com,e.com")).toEqual(["a.com", "b.com", "c.com", "d.com", "e.com"]);
  });
});

describe("buildQuickDnsConfConfig", () => {
  it("preserves custom sources while updating managed quick-mode sources", () => {
    const config = buildQuickDnsConfConfig({
      profiles: [{ clientId: "", authSecret: "", provider: "cloudflare", donorDns: DEFAULT_DNS_DONOR }],
      existingBlocklists: ["https://custom.test/block", OISD_SMALL_BLOCK_DOMAINS],
      existingRedirects: ["https://custom.test/redirect", GEOHIDE_HOSTS_LIST, MALW_HOSTS_LIST],
      existingRedirectExclusions: ["keep.example"],
      geoBlock: true,
      geoHideChecked: false,
      malwChecked: true,
      blockAds: false,
      retainCredentials: true
    });

    expect(config.blocklists).toEqual(["https://custom.test/block"]);
    expect(config.redirects).toEqual(["https://custom.test/redirect", MALW_HOSTS_LIST]);
    expect(config.redirectExclusions).toEqual(["keep.example"]);
  });

  it("does not alter NextDNS block sources when direct API settings are locked", () => {
    const config = buildQuickDnsConfConfig({
      profiles: [{ clientId: "", authSecret: "", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR }],
      existingBlocklists: [OISD_SMALL_BLOCK_DOMAINS],
      existingRedirects: [],
      existingRedirectExclusions: [],
      geoBlock: false,
      geoHideChecked: false,
      malwChecked: false,
      blockAds: false,
      retainCredentials: true
    });

    expect(config.blocklists).toEqual([OISD_SMALL_BLOCK_DOMAINS]);
  });

  it("removes every redirect source when geo-blocking is disabled", () => {
    const config = buildQuickDnsConfConfig({
      profiles: [{ clientId: "", authSecret: "", provider: "cloudflare", donorDns: DEFAULT_DNS_DONOR }],
      existingBlocklists: [],
      existingRedirects: ["https://custom.test/redirect", GEOHIDE_HOSTS_LIST],
      existingRedirectExclusions: [],
      geoBlock: false,
      geoHideChecked: true,
      malwChecked: false,
      blockAds: false,
      retainCredentials: true
    });

    expect(config.redirects).toEqual([]);
  });
});
