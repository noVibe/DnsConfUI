import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOSTS_SOURCE,
  HOSTS_SOURCES,
  type HostsSource,
  getHostsSource,
  hostsSourceUrls,
  isHostsSourceKey
} from "./hosts-sources";

describe("HOSTS_SOURCES", () => {
  it("offers both built-in lists, GeoHide first", () => {
    expect(HOSTS_SOURCES.map((source) => source.key)).toEqual(["geohide", "malw"]);
    expect(DEFAULT_HOSTS_SOURCE).toBe("geohide");
  });

  it("points at the raw files rather than at the help pages", () => {
    expect(getHostsSource("geohide")).toMatchObject({
      label: "GeoHide",
      url: "https://geohide.ru/hosts",
      mirror: "https://raw.githubusercontent.com/Internet-Helper/GeoHideDNS/refs/heads/main/hosts/hosts",
      site: "https://geohide.ru"
    });
    expect(getHostsSource("malw")).toMatchObject({
      label: "Malw",
      url: "https://raw.githubusercontent.com/ImMALWARE/dns.malw.link/master/hosts",
      site: "https://info.dns.malw.link/hosts"
    });
    // info.dns.malw.link serves HTML, so it may only be linked, never fetched.
    expect(hostsSourceUrls("malw")).not.toContain("https://info.dns.malw.link/hosts");
  });

  it("uses absolute https URLs everywhere", () => {
    const sources: readonly HostsSource[] = HOSTS_SOURCES;

    for (const source of sources) {
      for (const url of [source.url, source.mirror, source.site]) {
        if (url !== undefined) expect(url.startsWith("https://")).toBe(true);
      }
    }
  });
});

describe("isHostsSourceKey", () => {
  it("accepts the known keys", () => {
    expect(isHostsSourceKey("geohide")).toBe(true);
    expect(isHostsSourceKey("malw")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["", "GeoHide", "geohide ", "https://geohide.ru/hosts", "__proto__", "toString"]) {
      expect(isHostsSourceKey(value)).toBe(false);
    }
  });
});

describe("hostsSourceUrls", () => {
  it("lists the primary URL first and the mirror after it", () => {
    expect(hostsSourceUrls("geohide")).toEqual([
      "https://geohide.ru/hosts",
      "https://raw.githubusercontent.com/Internet-Helper/GeoHideDNS/refs/heads/main/hosts/hosts"
    ]);
  });

  it("lists a single URL for a source without a mirror", () => {
    expect(hostsSourceUrls("malw")).toEqual([
      "https://raw.githubusercontent.com/ImMALWARE/dns.malw.link/master/hosts"
    ]);
  });

  it("returns nothing for an unknown key", () => {
    expect(hostsSourceUrls("nope")).toEqual([]);
    expect(getHostsSource("nope")).toBeUndefined();
  });
});
