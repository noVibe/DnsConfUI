import { describe, expect, it } from "vitest";
import { chooseStickyIps, compressDomains, normalizeDomain, parseHostsOverrides } from "./hosts-parser";

describe("normalizeDomain", () => {
  it("normalizes case, trailing dots, Punycode IDN and optional www prefix", () => {
    expect(normalizeDomain("  Example.COM. ")).toBe("example.com");
    expect(normalizeDomain("www.example.com", { stripWww: true })).toBe("example.com");
    expect(normalizeDomain("www.example.com", { stripWww: false })).toBe("www.example.com");
    expect(normalizeDomain("тест.рф")).toBe("xn--e1aybc.xn--p1ai");
  });

  it("rejects localhost, wildcards, URLs and invalid labels", () => {
    for (const bad of ["localhost", "ip6-localhost", "*.example.com", "https://example.com", "singlelabel", "-bad.com", ""]) {
      expect(normalizeDomain(bad), bad).toBeNull();
    }
  });
});

describe("parseHostsOverrides", () => {
  it("extracts public override IPs, supports multiple aliases and skips blocking/private IPs", () => {
    const hosts = [
      "# header comment",
      "! adblock comment",
      "127.0.0.1 localhost",
      "0.0.0.0 blocked.example",
      "10.0.0.5 internal.example",
      "::1 ip6-localhost",
      "198.51.100.10 chatgpt.com www.chatgpt.com # inline",
      "198.51.100.11 chatgpt.com",
      "198.51.100.10 chatgpt.com",
      "2001:db8::10 ipv6.example"
    ].join("\r\n");

    expect(parseHostsOverrides(hosts)).toEqual([
      { domain: "chatgpt.com", ips: ["198.51.100.10", "198.51.100.11"] },
      { domain: "www.chatgpt.com", ips: ["198.51.100.10"] },
      { domain: "ipv6.example", ips: ["2001:db8::10"] }
    ]);
  });
});

describe("compressDomains", () => {
  it("matches DnsConf HostsCompressor behavior on subdomains, siblings and partial label overlaps", () => {
    expect(
      compressDomains([
        "gemini.google.com",
        "v1.gemini.google.com",
        "google.com",
        "openai.com",
        "openai.com",
        "v2.openai.com",
        "ample.com",
        "example.com",
        "a.example.org",
        "b.example.org",
        "a.b.c.d.e.f.example.com"
      ])
    ).toEqual([
      "a.example.org",
      "ample.com",
      "b.example.org",
      "example.com",
      "google.com",
      "openai.com"
    ]);
  });
});

describe("chooseStickyIps", () => {
  it("preserves previous live IP order across shuffled DNS answers and caps at maxIps", () => {
    const first = chooseStickyIps([], ["193.233.112.88", "159.194.200.33", "193.233.112.68", "193.233.112.67"], 4);
    expect(first).toEqual(["159.194.200.33", "193.233.112.67", "193.233.112.68", "193.233.112.88"]);

    // Shuffled reply from donor keeps the exact same order so ETag stays identical.
    const second = chooseStickyIps(first, ["193.233.112.68", "193.233.112.67", "193.233.112.88", "159.194.200.33"], 4);
    expect(second).toEqual(first);

    // When one node rotates out, remaining nodes stay in place and a new live node fills the free slot.
    const third = chooseStickyIps(first, ["193.233.112.67", "193.233.112.88", "159.194.200.33", "198.51.100.99", "198.51.100.100"], 4);
    expect(third).toEqual(["159.194.200.33", "193.233.112.67", "193.233.112.88", "198.51.100.99"]);
  });

  it("filters out blocking and non-public IPs returned by a donor", () => {
    expect(chooseStickyIps([], ["0.0.0.0", "127.0.0.1", "10.0.0.1"], 4)).toEqual([]);
  });
});
