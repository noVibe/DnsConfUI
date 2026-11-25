import { describe, expect, it } from "vitest";
import { DNS_DONORS, getDnsDonorBySlug, normalizeDonorSlug } from "./dns-donors";
import {
  buildAdGuardListPath,
  DEFAULT_ADGUARD_MAX_IPS,
  DEFAULT_ADGUARD_SOURCES,
  extractCandidateDomain,
  isValidExcludeDomain,
  parseAdGuardQueryParams,
  parseExcludeInput
} from "./adguard-sources";

describe("dns donor slugs", () => {
  it("assigns a unique lowercase slug to every donor", () => {
    const slugs = DNS_DONORS.map((donor) => donor.slug);
    expect(new Set(slugs).size).toBe(DNS_DONORS.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("resolves donors with or without a .txt suffix and case-insensitively", () => {
    expect(normalizeDonorSlug("GeoHide-EU.txt")).toBe("geohide-eu");
    expect(getDnsDonorBySlug("geohide-eu")?.value).toBe("https://eu.geohide.ru/dns-query");
    expect(getDnsDonorBySlug("comss.txt")?.value).toBe("https://dns.comss.one/dns-query");
    expect(getDnsDonorBySlug("unknown")).toBeUndefined();
  });
});

describe("exclude domain extraction and validation", () => {
  it("extracts hostnames from pasted URLs and paths while flagging invalid tokens", () => {
    expect(extractCandidateDomain("https://Instagram.com/reels?x=1")).toBe("instagram.com");
    expect(extractCandidateDomain("twitch.tv/directory/")).toBe("twitch.tv");
    expect(extractCandidateDomain("sub.example.org.")).toBe("sub.example.org");

    expect(
      parseExcludeInput("https://instagram.com/foo\ntwitch.tv/bar, invalid -bad.com .. 127.0.0.1 instagram.com")
    ).toEqual({
      valid: ["instagram.com", "twitch.tv"],
      invalid: ["invalid", "-bad.com", "..", "127.0.0.1"],
      overflowCount: 0
    });
  });

  it("rejects malformed hostnames consistently with compiler validation", () => {
    for (const bad of ["..", ".com", "a..b.com", "-bad.com", "bad-.com", "localhost", "*.example.com", "127.0.0.1"]) {
      expect(isValidExcludeDomain(bad), bad).toBe(false);
    }
    for (const good of ["instagram.com", "sub.twitch.tv", "тест.рф", "a.co"]) {
      expect(isValidExcludeDomain(good), good).toBe(true);
    }
  });
});

describe("parseAdGuardQueryParams", () => {
  it("returns defaults when no query parameters are supplied", () => {
    const result = parseAdGuardQueryParams(new URLSearchParams());
    expect(result).toEqual({
      ok: true,
      options: {
        sources: [...DEFAULT_ADGUARD_SOURCES],
        exclude: [],
        mode: "sub",
        compress: true,
        maxIps: DEFAULT_ADGUARD_MAX_IPS
      }
    });
  });

  it("parses custom sources, exclusions, mode, compress flag and IP limit", () => {
    const result = parseAdGuardQueryParams(
      new URLSearchParams("sources=malw,geohide,malw&exclude=Instagram.com.,sub.twitch.tv&mode=exact&compress=0&ips=2")
    );
    expect(result).toEqual({
      ok: true,
      options: {
        sources: ["malw", "geohide"],
        exclude: ["instagram.com", "sub.twitch.tv"],
        mode: "exact",
        compress: false,
        maxIps: 2
      }
    });
  });

  it.each([
    "sources=unknown",
    "mode=regex",
    "compress=maybe",
    "ips=0",
    "ips=5",
    "ips=abc",
    "exclude=https://example.com",
    "exclude=notadomain",
    "exclude=..",
    "exclude=.com",
    "exclude=-bad.com",
    "exclude=a..b.com",
    "exclude=127.0.0.1"
  ])("rejects invalid query %s", (query) => {
    expect(parseAdGuardQueryParams(new URLSearchParams(query)).ok).toBe(false);
  });
});

describe("buildAdGuardListPath", () => {
  it("returns a clean path without query string when defaults are used", () => {
    expect(buildAdGuardListPath("geohide-eu")).toBe("/adguard/geohide-eu");
    expect(
      buildAdGuardListPath("comss", {
        sources: ["geohide", "malw"],
        exclude: [],
        mode: "sub",
        compress: true,
        maxIps: 4
      })
    ).toBe("/adguard/comss");
  });

  it("includes only non-default parameters and omits compress in exact mode", () => {
    expect(
      buildAdGuardListPath("geohide-ru", {
        sources: ["geohide"],
        exclude: ["instagram.com"],
        maxIps: 1
      })
    ).toBe("/adguard/geohide-ru?sources=geohide&exclude=instagram.com&ips=1");

    expect(
      buildAdGuardListPath("comss", {
        mode: "exact",
        compress: false
      })
    ).toBe("/adguard/comss?mode=exact");
  });
});
