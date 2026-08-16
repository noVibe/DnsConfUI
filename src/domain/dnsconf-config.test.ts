import { describe, expect, it } from "vitest";
import {
  buildDnsConfPayload,
  defaultDnsConfConfig,
  dnsConfConfigSchema,
  getWizardStepValidity
} from "./dnsconf-config";
import { DEFAULT_DNS_DONOR } from "./dns-donors";

const validConfig = {
  profiles: [{ clientId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", authSecret: "secret-token", provider: "cloudflare" as const, donorDns: DEFAULT_DNS_DONOR }],
  blocklists: ["https://example.com/block.txt", "https://filters.test/list"],
  redirects: ["https://example.com/redirect-hosts.txt"],
  redirectExclusions: ["keep.example"]
};

describe("dnsConfConfigSchema", () => {
  it("enables GeoHide for the default profile", () => {
    expect(defaultDnsConfConfig.profiles[0].donorDns).toBe(DEFAULT_DNS_DONOR);
  });

  it("accepts the minimum valid Cloudflare configuration", () => {
    const result = dnsConfConfigSchema.safeParse(validConfig);

    expect(result.success).toBe(true);
  });

  it("requires valid source list URLs", () => {
    const result = dnsConfConfigSchema.safeParse({
      ...validConfig,
      blocklists: ["not-a-url"]
    });

    expect(result.success).toBe(false);
  });

  it("requires valid redirect source URLs when REDIRECT is provided", () => {
    const result = dnsConfConfigSchema.safeParse({
      ...validConfig,
      redirects: ["bad.example=safe.example"]
    });

    expect(result.success).toBe(false);
  });

  it("allows empty BLOCK and REDIRECT sources", () => {
    const result = dnsConfConfigSchema.safeParse({
      ...validConfig,
      blocklists: [],
      redirects: []
    });

    expect(result.success).toBe(true);
  });

  it("rejects Cloudflare client ID that is not 32 characters", () => {
    const result = dnsConfConfigSchema.safeParse({
      ...validConfig,
      profiles: [{ clientId: "short", authSecret: "secret", provider: "cloudflare", donorDns: DEFAULT_DNS_DONOR }]
    });

    expect(result.success).toBe(false);
  });

  it("rejects NextDNS client ID that is not 6 characters", () => {
    const result = dnsConfConfigSchema.safeParse({
      ...validConfig,
      profiles: [{ clientId: "toolongid", authSecret: "secret", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR }]
    });

    expect(result.success).toBe(false);
  });

  it("accepts valid NextDNS client ID with 6 characters", () => {
    const result = dnsConfConfigSchema.safeParse({
      ...validConfig,
      profiles: [{ clientId: "abc123", authSecret: "secret", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR }]
    });

    expect(result.success).toBe(true);
  });

  it("accepts multiple profiles", () => {
    const result = dnsConfConfigSchema.safeParse({
      ...validConfig,
      profiles: [
        { clientId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", authSecret: "secret1", provider: "cloudflare", donorDns: DEFAULT_DNS_DONOR },
        { clientId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", authSecret: "secret2", provider: "cloudflare", donorDns: "" }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("accepts IPv4 and DoH donors and allows the donor to be disabled", () => {
    for (const donorDns of ["1.1.1.1", "https://dns.example/dns-query", ""]) {
      expect(dnsConfConfigSchema.safeParse({
        ...validConfig,
        profiles: [{ ...validConfig.profiles[0], donorDns }]
      }).success).toBe(true);
    }
  });

  it("rejects an invalid DNS donor", () => {
    const result = dnsConfConfigSchema.safeParse({
      ...validConfig,
      profiles: [{ ...validConfig.profiles[0], donorDns: "not-a-dns-resolver" }]
    });

    expect(result.success).toBe(false);
  });
});

describe("buildDnsConfPayload", () => {
  it("maps current DnsConf workflow inputs to GitHub secrets and variables", () => {
    const payload = buildDnsConfPayload(validConfig);

    expect(payload.secrets).toEqual({
      CLIENT_ID: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      AUTH_SECRET: "secret-token"
    });
    expect(payload.variables).toEqual({
      DNS: "cloudflare",
      DONOR_DNS: DEFAULT_DNS_DONOR,
      BLOCK: "https://example.com/block.txt,https://filters.test/list",
      REDIRECT: "https://example.com/redirect-hosts.txt",
      EXCLUDE_REDIRECT: "keep.example"
    });
  });

  it("joins multiple profiles with comma separator", () => {
    const payload = buildDnsConfPayload({
      ...validConfig,
      profiles: [
        { clientId: "11111111111111111111111111111111", authSecret: "sec1", provider: "cloudflare", donorDns: DEFAULT_DNS_DONOR },
        { clientId: "22222222222222222222222222222222", authSecret: "sec2", provider: "cloudflare", donorDns: "" }
      ]
    });

    expect(payload.secrets).toEqual({
      CLIENT_ID: "11111111111111111111111111111111,22222222222222222222222222222222",
      AUTH_SECRET: "sec1,sec2"
    });
    expect(payload.variables.DNS).toBe("cloudflare,cloudflare");
    expect(payload.variables.DONOR_DNS).toBe(`${DEFAULT_DNS_DONOR},-`);
  });

  it("joins multiple profiles with different providers", () => {
    const payload = buildDnsConfPayload({
      ...validConfig,
      profiles: [
        { clientId: "11111111111111111111111111111111", authSecret: "sec1", provider: "cloudflare", donorDns: "https://xbox-dns.ru/dns-query" },
        { clientId: "abc123", authSecret: "sec2", provider: "nextdns", donorDns: "https://dns.comss.one/dns-query" }
      ]
    });

    expect(payload.secrets).toEqual({
      CLIENT_ID: "11111111111111111111111111111111,abc123",
      AUTH_SECRET: "sec1,sec2"
    });
    expect(payload.variables.DNS).toBe("cloudflare,nextdns");
    expect(payload.variables.DONOR_DNS).toBe("https://xbox-dns.ru/dns-query,https://dns.comss.one/dns-query");
  });

  it("keeps disabled donors positionally aligned for every profile", () => {
    const payload = buildDnsConfPayload({
      ...validConfig,
      profiles: [
        { clientId: "11111111111111111111111111111111", authSecret: "sec1", provider: "cloudflare", donorDns: "" },
        { clientId: "22222222222222222222222222222222", authSecret: "sec2", provider: "cloudflare", donorDns: "" }
      ]
    });

    expect(payload.variables.DONOR_DNS).toBe("-,-");
  });

  it("joins multiple entries with comma separator", () => {
    const payload = buildDnsConfPayload({
      ...validConfig,
      blocklists: ["https://block.a", "https://block.b", "https://block.c"],
      redirects: ["https://redir.a", "https://redir.b"],
      redirectExclusions: ["ex.a", "ex.b", "ex.c"]
    });

    expect(payload.variables.BLOCK).toBe("https://block.a,https://block.b,https://block.c");
    expect(payload.variables.REDIRECT).toBe("https://redir.a,https://redir.b");
    expect(payload.variables.EXCLUDE_REDIRECT).toBe("ex.a,ex.b,ex.c");
  });
});

describe("getWizardStepValidity", () => {
  it("reports which wizard steps can advance", () => {
    expect(getWizardStepValidity(1, validConfig)).toBe(true);
    expect(getWizardStepValidity(1, { profiles: [{ clientId: "id", authSecret: "secret", provider: "", donorDns: DEFAULT_DNS_DONOR }] })).toBe(false);
    expect(getWizardStepValidity(2, { ...validConfig, profiles: [{ clientId: "id", authSecret: "", provider: "cloudflare", donorDns: DEFAULT_DNS_DONOR }] })).toBe(false);
    expect(getWizardStepValidity(3, { ...validConfig, blocklists: [] })).toBe(true);
  });
});
