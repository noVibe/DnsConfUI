import { describe, expect, it } from "vitest";
import { translate } from "./translate";

describe("translate", () => {
  it("returns the Russian translation for ru locale", () => {
    expect(translate("ru", "profiles.providerNextDNS")).toBe("NextDNS");
  });

  it("returns the English translation for en locale", () => {
    expect(translate("en", "profiles.providerCloudflare")).toBe("Cloudflare");
  });

  it("falls back to the raw key when key is missing in all locales", () => {
    const result = translate("en", "__nonexistent" as any);
    expect(result).toBe("__nonexistent");
  });

  it("interpolates a single parameter {provider}", () => {
    expect(translate("en", "profiles.dns", { provider: "Cloudflare" })).toBe("DNS: Cloudflare");
  });

  it("interpolates {label} parameter", () => {
    expect(translate("en", "sources.remove", { label: "Ad list" })).toBe("Remove Ad list");
  });

  it("interpolates {n} parameter", () => {
    expect(translate("en", "review.profile", { n: 2 })).toBe("Profile 2");
  });

  it("interpolates {value} parameter with English locale", () => {
    expect(translate("en", "review.secret", { value: "abc123" })).toBe("Secret: abc123");
  });

  it("interpolates parameters with Russian locale", () => {
    expect(translate("ru", "review.secret", { value: "секрет" })).toBe("Секрет: секрет");
  });

  it("interpolates parameters with numbers", () => {
    expect(translate("en", "review.profile", { n: 0 })).toBe("Profile 0");
  });

  it("interpolates multiple different parameters", () => {
    expect(translate("en", "profiles.dns", { provider: "NextDNS" })).toBe("DNS: NextDNS");
  });
});
