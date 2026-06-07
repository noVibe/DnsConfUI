import { describe, expect, it, vi } from "vitest";
import { fieldError, splitEntries, translatedError, extractProfileErrors, normalizeValues } from "./utils";

describe("fieldError", () => {
  it("returns undefined when parse succeeds", () => {
    expect(fieldError({ success: true }, "name")).toBeUndefined();
  });

  it("returns undefined when error is missing", () => {
    expect(fieldError({ success: false }, "name")).toBeUndefined();
  });

  it("returns the message for the matching field", () => {
    const parsed = {
      success: false,
      error: { issues: [{ path: ["name"], message: "Required" }] }
    };
    expect(fieldError(parsed, "name")).toBe("Required");
  });

  it("returns undefined when field has no issues", () => {
    const parsed = {
      success: false,
      error: { issues: [{ path: ["other"], message: "Bad" }] }
    };
    expect(fieldError(parsed, "name")).toBeUndefined();
  });
});

describe("splitEntries", () => {
  it("splits by newline", () => {
    expect(splitEntries("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("splits by comma", () => {
    expect(splitEntries("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("splits by comma with space", () => {
    expect(splitEntries("a, b, c")).toEqual(["a", "b", "c"]);
  });

  it("trims leading and trailing whitespace", () => {
    expect(splitEntries("  a  ,  b  ")).toEqual(["a", "b"]);
  });

  it("removes empty entries", () => {
    expect(splitEntries("a,,b\n\nc")).toEqual(["a", "b", "c"]);
  });

  it("handles Windows-style CRLF", () => {
    expect(splitEntries("a\r\nb\r\nc")).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for empty string", () => {
    expect(splitEntries("")).toEqual([]);
  });

  it("returns empty array for whitespace only", () => {
    expect(splitEntries(" \n , ")).toEqual([]);
  });
});

describe("translatedError", () => {
  it("returns undefined for undefined input", () => {
    expect(translatedError(undefined, () => "")).toBeUndefined();
  });

  it("translates validation.* keys via t()", () => {
    const t = vi.fn(() => "translated");
    expect(translatedError("validation.clientIdRequired", t)).toBe("translated");
    expect(t).toHaveBeenCalledWith("validation.clientIdRequired");
  });

  it("returns non-validation strings as-is", () => {
    expect(translatedError("Something went wrong", () => "")).toBe("Something went wrong");
  });

  it("returns key itself when t() returns the key (missing translation)", () => {
    const t = vi.fn((key: string) => key);
    expect(translatedError("validation.unknown", t)).toBe("validation.unknown");
  });
});

describe("extractProfileErrors", () => {
  it("returns undefined when parse succeeds", () => {
    expect(extractProfileErrors({ success: true }, "clientId")).toBeUndefined();
  });

  it("extracts errors matching the profile path pattern", () => {
    const parsed = {
      success: false,
      error: {
        issues: [
          { path: ["profiles", 0, "clientId"], message: "Invalid format" },
          { path: ["profiles", 1, "clientId"], message: "Required" },
          { path: ["profiles", 0, "authSecret"], message: "Required" }
        ]
      }
    };
    expect(extractProfileErrors(parsed, "clientId")).toEqual([
      { index: 0, message: "Invalid format" },
      { index: 1, message: "Required" }
    ]);
  });

  it("ignores issues for a different field", () => {
    const parsed = {
      success: false,
      error: {
        issues: [
          { path: ["profiles", 0, "clientId"], message: "Bad" },
          { path: ["profiles", 0, "authSecret"], message: "Required" }
        ]
      }
    };
    expect(extractProfileErrors(parsed, "authSecret")).toEqual([
      { index: 0, message: "Required" }
    ]);
  });

  it("ignores top-level (non-profile) issues", () => {
    const parsed = {
      success: false,
      error: {
        issues: [
          { path: ["blocklists"], message: "Invalid URL" },
          { path: ["profiles", 0, "clientId"], message: "Bad" }
        ]
      }
    };
    expect(extractProfileErrors(parsed, "clientId")).toEqual([
      { index: 0, message: "Bad" }
    ]);
  });
});

describe("normalizeValues", () => {
  it("joins and splits blocklists by newline", () => {
    const result = normalizeValues({
      profiles: [],
      blocklists: ["https://a.com/list", "https://b.com/list"],
      redirects: [],
      redirectExclusions: []
    });
    expect(result.blocklists).toEqual(["https://a.com/list", "https://b.com/list"]);
  });

  it("joins and splits redirects by newline", () => {
    const result = normalizeValues({
      profiles: [],
      blocklists: [],
      redirects: ["https://a.com/redir", "https://b.com/redir"],
      redirectExclusions: []
    });
    expect(result.redirects).toEqual(["https://a.com/redir", "https://b.com/redir"]);
  });

  it("joins and splits redirectExclusions by space", () => {
    const result = normalizeValues({
      profiles: [],
      blocklists: [],
      redirects: [],
      redirectExclusions: ["ex.a", "ex.b"]
    });
    expect(result.redirectExclusions).toEqual(["ex.a", "ex.b"]);
  });

  it("coalesces undefined arrays to empty arrays", () => {
    const result = normalizeValues({
      profiles: [],
      blocklists: [],
      redirects: [],
      redirectExclusions: []
    });
    expect(result.blocklists).toEqual([]);
    expect(result.redirects).toEqual([]);
    expect(result.redirectExclusions).toEqual([]);
  });

  it("preserves profiles unchanged", () => {
    const profiles = [{ clientId: "abc", authSecret: "sec", provider: "cloudflare" as const }];
    const result = normalizeValues({
      profiles,
      blocklists: [],
      redirects: [],
      redirectExclusions: []
    });
    expect(result.profiles).toBe(profiles);
  });
});
