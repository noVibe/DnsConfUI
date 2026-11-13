import { describe, expect, it } from "vitest";
import { DNS_DONORS, isCheckableDonor } from "./dns-donors";

describe("isCheckableDonor", () => {
  it("accepts every preset", () => {
    expect(DNS_DONORS.every((donor) => isCheckableDonor(donor.value))).toBe(true);
  });

  it("accepts any HTTPS DoH URL a user wants to try", () => {
    expect(isCheckableDonor("https://dns.example/dns-query")).toBe(true);
    expect(isCheckableDonor("https://dns.example:8443/dns-query?x=1")).toBe(true);
    expect(isCheckableDonor("https://203.0.113.9/dns-query")).toBe(true);
  });

  it("refuses anything but HTTPS", () => {
    expect(isCheckableDonor("http://dns.example/dns-query")).toBe(false);
    expect(isCheckableDonor("tls://dns.example")).toBe(false);
    expect(isCheckableDonor("javascript:alert(1)")).toBe(false);
  });

  it("refuses credentials in the URL", () => {
    expect(isCheckableDonor("https://user:pass@dns.example/dns-query")).toBe(false);
    expect(isCheckableDonor("https://user@dns.example/dns-query")).toBe(false);
  });

  it("refuses a URL that is not a URL", () => {
    expect(isCheckableDonor("not a url")).toBe(false);
    expect(isCheckableDonor("")).toBe(false);
    expect(isCheckableDonor("dns.example/dns-query")).toBe(false);
  });

  it("caps the length at 2048 characters", () => {
    const path = (length: number) => `https://dns.example/${"a".repeat(length)}`;

    expect(isCheckableDonor(path(2048 - "https://dns.example/".length))).toBe(true);
    expect(isCheckableDonor(path(2049 - "https://dns.example/".length))).toBe(false);
    expect(isCheckableDonor(path(2048))).toBe(false);
  });
});
