import { describe, expect, it } from "vitest";
import {
  applyOverrides,
  isPlausibleHostname,
  isResolvableHostname,
  overridableHostnames,
  parseHosts,
  summarizeHosts
} from "./hosts";

// Fixtures are built with explicit escapes so the line endings under test never
// depend on the line endings of this source file.
const crlf = (...lines: string[]) => lines.join("\r\n");
const lf = (...lines: string[]) => lines.join("\n");

/** The shape that matters in practice: one hostname repeated once per proxy IP. */
const PROXY_IPS = ["159.194.200.33", "193.233.112.67", "193.233.112.68", "193.233.112.88"];

function proxyListFixture(hostnames: readonly string[]): string {
  const lines: string[] = ["### example: hosts file", "# updated yesterday", ""];
  for (const ip of PROXY_IPS) {
    for (const hostname of hostnames) lines.push(`${ip} ${hostname}`);
  }
  return `${crlf(...lines)}\r\n`;
}

describe("parseHosts", () => {
  it("records a CRLF file as CRLF with a trailing newline", () => {
    const parsed = parseHosts(crlf("# head", "1.2.3.4 a.example", ""));

    expect(parsed.lineEnding).toBe("\r\n");
    expect(parsed.endsWithNewline).toBe(true);
    expect(parsed.lines).toHaveLength(2);
  });

  it("records an LF file as LF", () => {
    const parsed = parseHosts(lf("# head", "1.2.3.4 a.example", ""));

    expect(parsed.lineEnding).toBe("\n");
    expect(parsed.endsWithNewline).toBe(true);
  });

  it("records a missing trailing newline", () => {
    const parsed = parseHosts(crlf("# head", "1.2.3.4 a.example"));

    expect(parsed.endsWithNewline).toBe(false);
    expect(parsed.lines).toHaveLength(2);
  });

  it("keeps every original line, in order and verbatim", () => {
    const text = crlf("### example: hosts file", "# Claude AI", "", "\t1.2.3.4   a.example  ", "");
    const parsed = parseHosts(text);

    expect(parsed.lines.map((line) => line.kind)).toEqual(["comment", "comment", "blank", "entry"]);
    expect(parsed.lines.map((line) => line.raw)).toEqual([
      "### example: hosts file",
      "# Claude AI",
      "",
      "\t1.2.3.4   a.example  "
    ]);
  });

  it("accepts tabs, runs of spaces and leading whitespace as separators", () => {
    const parsed = parseHosts(lf("1.2.3.4\ta.example", "   5.6.7.8     b.example"));

    expect(parsed.lines).toMatchObject([
      { kind: "entry", ip: "1.2.3.4", hostnames: ["a.example"] },
      { kind: "entry", ip: "5.6.7.8", hostnames: ["b.example"] }
    ]);
  });

  it("exposes a trailing inline comment separately from the entry", () => {
    const parsed = parseHosts("1.2.3.4 a.example # via the proxy\n");

    expect(parsed.lines[0]).toMatchObject({
      kind: "entry",
      ip: "1.2.3.4",
      hostnames: ["a.example"],
      comment: "# via the proxy"
    });
  });

  it("reads several hostnames from one line", () => {
    const parsed = parseHosts("1.2.3.4 a.example b.example c.example\n");

    expect(parsed.lines[0]).toMatchObject({
      hostnames: ["a.example", "b.example", "c.example"],
      entryClass: "overridable"
    });
  });

  it("classifies sinks, loopback, broadcast and IPv6 entries", () => {
    const parsed = parseHosts(
      lf(
        "0.0.0.0 ads.example",
        "127.0.0.1 localhost",
        "127.53.0.1 pinned.example",
        "255.255.255.255 broadcast.example",
        ":: unspecified.example",
        "::1 ip6-localhost",
        "2a02:e00:ffec:4b8::1 six.example",
        "9.9.9.9 proxied.example"
      )
    );

    expect(parsed.lines.map((line) => (line.kind === "entry" ? line.entryClass : line.kind))).toEqual([
      "blocking",
      "blocking",
      "blocking",
      "blocking",
      "blocking",
      "blocking",
      "ipv6",
      "overridable"
    ]);
  });

  it("rejects hostile or broken hostnames instead of treating them as names", () => {
    const parsed = parseHosts(
      lf(
        "1.2.3.4 *.example.com",
        "1.2.3.4 ../../etc/hosts",
        "1.2.3.4 http://example.com",
        "1.2.3.4 a.example;rm",
        "1.2.3.4 5.6.7.8",
        "1.2.3.4 ok.example bad!.example"
      )
    );

    expect(parsed.lines.every((line) => line.kind === "entry" && line.entryClass === "invalid")).toBe(true);
    expect(isPlausibleHostname("ok.example")).toBe(true);
    expect(isPlausibleHostname("xn--80ak6aa92e.com")).toBe(true);
    expect(isPlausibleHostname("-leading.example")).toBe(false);
    expect(isPlausibleHostname("")).toBe(false);
  });

  it("marks garbage that is not an entry as unparsed and leaves it alone", () => {
    const parsed = parseHosts(lf("1.2.3.4", "not-an-ip a.example", "<html>"));

    expect(parsed.lines.map((line) => line.kind)).toEqual(["unparsed", "unparsed", "unparsed"]);
    expect(applyOverrides(parsed, { "a.example": "9.9.9.9" })).toBe(
      lf("1.2.3.4", "not-an-ip a.example", "<html>")
    );
  });

  it("handles an empty file", () => {
    const parsed = parseHosts("");

    expect(parsed.lines).toEqual([]);
    expect(parsed.endsWithNewline).toBe(false);
    expect(applyOverrides(parsed, {})).toBe("");
  });
});

describe("isResolvableHostname", () => {
  it("accepts a name a public resolver can answer for", () => {
    expect(isResolvableHostname("ok.example")).toBe(true);
    expect(isResolvableHostname("a.b.c.example.com")).toBe(true);
    expect(isResolvableHostname("xn--80ak6aa92e.com")).toBe(true);
    expect(isResolvableHostname("_acme-challenge.example.com")).toBe(true);
    expect(isResolvableHostname(`${"a".repeat(63)}.example`)).toBe(true);
  });

  it("refuses what no public resolver can be asked about", () => {
    expect(isResolvableHostname("localhost")).toBe(false);
    expect(isResolvableHostname("myserver")).toBe(false);
    expect(isResolvableHostname("")).toBe(false);
    expect(isResolvableHostname("a.example.")).toBe(false);
    expect(isResolvableHostname("a..example")).toBe(false);
    expect(isResolvableHostname("-leading.example")).toBe(false);
    expect(isResolvableHostname("bad!.example")).toBe(false);
    expect(isResolvableHostname(`${"a".repeat(64)}.example`)).toBe(false);
    expect(isResolvableHostname(`${"a".repeat(125)}.${"b".repeat(125)}.example`)).toBe(false);
  });

  it("stays a separate question from isPlausibleHostname: a single label is a legal entry", () => {
    expect(isPlausibleHostname("localhost")).toBe(true);
    expect(isResolvableHostname("localhost")).toBe(false);
  });
});

describe("overridableHostnames", () => {
  it("returns distinct hostnames in order of first appearance", () => {
    const parsed = parseHosts(proxyListFixture(["b.example", "a.example"]));

    expect(overridableHostnames(parsed)).toEqual(["b.example", "a.example"]);
  });

  it("collapses the four-lines-per-hostname shape to one name each", () => {
    const hostnames = Array.from({ length: 25 }, (_, index) => `h${index}.example`);
    const parsed = parseHosts(proxyListFixture(hostnames));

    expect(summarizeHosts(parsed).entries).toBe(100);
    expect(overridableHostnames(parsed)).toEqual(hostnames);
  });

  it("skips blocking, IPv6 and implausible entries but keeps a name that also has a usable entry", () => {
    const parsed = parseHosts(
      lf(
        "0.0.0.0 ads.example",
        "127.0.0.1 localhost",
        "::1 ip6-localhost",
        "130.255.77.28 ntc.party",
        "2a02:e00:ffec:4b8::1 ntc.party",
        "1.2.3.4 *.bad.example"
      )
    );

    expect(overridableHostnames(parsed)).toEqual(["ntc.party"]);
  });

  it("treats hostnames case-insensitively and keeps the first spelling", () => {
    const parsed = parseHosts(lf("1.2.3.4 A.Example", "5.6.7.8 a.example"));

    expect(overridableHostnames(parsed)).toEqual(["A.Example"]);
  });

  it("leaves out a legal name no public resolver can be asked about", () => {
    const lines = ["4.4.4.4 single", "1.2.3.4 a.example intranet", "5.6.7.8 b.example", "7.7.7.7 single"];
    const parsed = parseHosts(lf(...lines));

    // The lines themselves stay overridable, so the single-label names keep their original address.
    expect(parsed.lines.every((line) => line.kind === "entry" && line.entryClass === "overridable")).toBe(true);
    expect(overridableHostnames(parsed)).toEqual(["a.example", "b.example"]);
    // `single` appears twice and is counted once, as the resolvable names are.
    expect(summarizeHosts(parsed)).toMatchObject({ overridableHostnames: 2, unresolvableHostnames: 2 });
    expect(applyOverrides(parsed, {})).toBe(lf(...lines));
  });
});

describe("applyOverrides", () => {
  it("collapses four duplicate lines into one at the first position", () => {
    const parsed = parseHosts(proxyListFixture(["a.example", "b.example"]));

    const result = applyOverrides(parsed, { "a.example": "10.0.0.1", "b.example": "10.0.0.2" });

    expect(result).toBe(
      `${crlf(
        "### example: hosts file",
        "# updated yesterday",
        "",
        "10.0.0.1 a.example",
        "10.0.0.2 b.example"
      )}\r\n`
    );
  });

  it("preserves CRLF endings", () => {
    const result = applyOverrides(parseHosts(crlf("# head", "1.2.3.4 a.example", "")), {
      "a.example": "9.9.9.9"
    });

    expect(result).toBe("# head\r\n9.9.9.9 a.example\r\n");
    expect(result).not.toContain("\n\n");
  });

  it("leaves an LF file as LF", () => {
    const result = applyOverrides(parseHosts(lf("# head", "1.2.3.4 a.example", "")), {
      "a.example": "9.9.9.9"
    });

    expect(result).toBe("# head\n9.9.9.9 a.example\n");
    expect(result).not.toContain("\r");
  });

  it("keeps a missing trailing newline missing", () => {
    const result = applyOverrides(parseHosts(crlf("# head", "1.2.3.4 a.example")), {
      "a.example": "9.9.9.9"
    });

    expect(result).toBe("# head\r\n9.9.9.9 a.example");
  });

  it("passes blocking entries through a run untouched", () => {
    const text = crlf(
      "0.0.0.0 ads.example",
      "0.0.0.0\ttracker.example  ",
      "127.0.0.1 localhost",
      "255.255.255.255 broadcast.example",
      "1.2.3.4 a.example",
      ""
    );

    const result = applyOverrides(parseHosts(text), {
      "ads.example": "9.9.9.9",
      "tracker.example": "9.9.9.9",
      localhost: "9.9.9.9",
      "broadcast.example": "9.9.9.9",
      "a.example": "9.9.9.9"
    });

    expect(result).toBe(
      `${crlf(
        "0.0.0.0 ads.example",
        "0.0.0.0\ttracker.example  ",
        "127.0.0.1 localhost",
        "255.255.255.255 broadcast.example",
        "9.9.9.9 a.example"
      )}\r\n`
    );
  });

  it("passes IPv6 entries through untouched even when the name was resolved", () => {
    const text = crlf("130.255.77.28 ntc.party", "2a02:e00:ffec:4b8::1 ntc.party", "::1 ip6-localhost", "");

    const result = applyOverrides(parseHosts(text), { "ntc.party": "10.0.0.1", "ip6-localhost": "10.0.0.2" });

    expect(result).toBe(
      `${crlf("10.0.0.1 ntc.party", "2a02:e00:ffec:4b8::1 ntc.party", "::1 ip6-localhost")}\r\n`
    );
  });

  it("leaves the blocking entries out of the result when their class is omitted", () => {
    const text = crlf("# head", "0.0.0.0 ads.example", "127.0.0.1 localhost", "", "1.2.3.4 a.example", "");

    const result = applyOverrides(parseHosts(text), { "a.example": "9.9.9.9" }, { omit: ["blocking"] });

    // The comment and the blank line say what the file is, so they stay whatever is left out of it.
    expect(result).toBe(`${crlf("# head", "", "9.9.9.9 a.example")}\r\n`);
  });

  it("leaves the entries nothing can refresh out of the result when their classes are omitted", () => {
    const text = crlf(
      "# head",
      "2a02:e00:ffec:4b8::1 ntc.party",
      "5.5.5.5 not a_hostname!",
      "0.0.0.0 ads.example",
      "1.2.3.4 a.example",
      ""
    );

    const result = applyOverrides(parseHosts(text), { "a.example": "9.9.9.9" }, { omit: ["ipv6", "invalid"] });

    expect(result).toBe(`${crlf("# head", "0.0.0.0 ads.example", "9.9.9.9 a.example")}\r\n`);
  });

  it("carries every class when nothing is omitted", () => {
    const parsed = parseHosts(crlf("0.0.0.0 ads.example", "2a02:e00:ffec:4b8::1 ntc.party", "1.2.3.4 a.example", ""));
    const overrides = { "a.example": "9.9.9.9" };

    expect(applyOverrides(parsed, overrides, { omit: [] })).toBe(applyOverrides(parsed, overrides));
    expect(applyOverrides(parsed, overrides)).toContain("0.0.0.0 ads.example");
  });

  it("keeps the file's own ending when the omitted class held the last line", () => {
    const result = applyOverrides(
      parseHosts(`${lf("1.2.3.4 a.example", "0.0.0.0 ads.example")}\n`),
      { "a.example": "9.9.9.9" },
      { omit: ["blocking"] }
    );

    expect(result).toBe("9.9.9.9 a.example\n");
    expect(result).not.toContain("\r");
  });

  it("keeps comments, section headers and blank lines in place", () => {
    const text = crlf(
      "### example: hosts file",
      "# updated yesterday",
      "",
      "# Claude AI",
      "1.2.3.4 claude.ai",
      "",
      "# OpenAI",
      "1.2.3.4 chatgpt.com",
      ""
    );

    const result = applyOverrides(parseHosts(text), { "claude.ai": "10.0.0.1", "chatgpt.com": "10.0.0.2" });

    expect(result).toBe(
      `${crlf(
        "### example: hosts file",
        "# updated yesterday",
        "",
        "# Claude AI",
        "10.0.0.1 claude.ai",
        "",
        "# OpenAI",
        "10.0.0.2 chatgpt.com"
      )}\r\n`
    );
  });

  it("keeps every original line of a hostname that was not resolved", () => {
    const text = proxyListFixture(["kept.example", "fresh.example"]);

    const result = applyOverrides(parseHosts(text), { "fresh.example": "10.0.0.1" });

    expect(result).toBe(
      `${crlf(
        "### example: hosts file",
        "# updated yesterday",
        "",
        "159.194.200.33 kept.example",
        "10.0.0.1 fresh.example",
        "193.233.112.67 kept.example",
        "193.233.112.68 kept.example",
        "193.233.112.88 kept.example"
      )}\r\n`
    );
  });

  it("rewrites an indented, tab-separated entry canonically and keeps its inline comment", () => {
    const result = applyOverrides(parseHosts("  1.2.3.4\t\ta.example   # supercell\n"), {
      "a.example": "9.9.9.9"
    });

    expect(result).toBe("9.9.9.9 a.example # supercell\n");
  });

  it("regroups a multi-hostname line by new address and keeps unresolved names on the original IP", () => {
    const result = applyOverrides(
      parseHosts("1.2.3.4 a.example b.example c.example d.example # group\n"),
      { "a.example": "10.0.0.1", "c.example": "10.0.0.1", "d.example": "10.0.0.2" }
    );

    expect(result).toBe(
      lf("10.0.0.1 a.example c.example # group", "1.2.3.4 b.example", "10.0.0.2 d.example", "")
    );
  });

  it("drops a hostname from a later multi-hostname line once it has been emitted", () => {
    const text = lf("1.2.3.4 a.example", "5.6.7.8 a.example b.example", "5.6.7.8 a.example", "");

    const result = applyOverrides(parseHosts(text), { "a.example": "10.0.0.1" });

    expect(result).toBe(lf("10.0.0.1 a.example", "5.6.7.8 b.example", ""));
  });

  it("never rewrites a line holding an implausible hostname", () => {
    const text = lf("1.2.3.4 ok.example *.bad.example", "1.2.3.4 ok.example", "");

    const result = applyOverrides(parseHosts(text), { "ok.example": "10.0.0.1" });

    expect(result).toBe(lf("1.2.3.4 ok.example *.bad.example", "10.0.0.1 ok.example", ""));
  });

  it("ignores override values that are not IPv4 addresses", () => {
    const text = lf("1.2.3.4 a.example", "1.2.3.4 b.example", "1.2.3.4 c.example", "1.2.3.4 d.example", "");

    const result = applyOverrides(parseHosts(text), {
      "a.example": "",
      "b.example": "2a02:e00:ffec:4b8::1",
      "c.example": "not-an-ip",
      "d.example": " 10.0.0.1 "
    });

    expect(result).toBe(
      lf("1.2.3.4 a.example", "1.2.3.4 b.example", "1.2.3.4 c.example", "10.0.0.1 d.example", "")
    );
  });

  it("accepts a Map of overrides and matches hostnames case-insensitively", () => {
    const result = applyOverrides(parseHosts("1.2.3.4 A.Example\n"), new Map([["a.example", "10.0.0.1"]]));

    expect(result).toBe("10.0.0.1 A.Example\n");
  });

  it("returns the file unchanged when nothing resolved", () => {
    const text = proxyListFixture(["a.example", "b.example"]);

    expect(applyOverrides(parseHosts(text), {})).toBe(text);
  });
});

describe("summarizeHosts", () => {
  it("counts entries, overridable hostnames, blocking entries and comments", () => {
    const text = crlf(
      "### example: hosts file",
      "# updated yesterday",
      "",
      "0.0.0.0 ads.example",
      "0.0.0.0 tracker.example",
      "127.0.0.1 localhost",
      "::1 ip6-localhost",
      "2a02:e00:ffec:4b8::1 six.example",
      "1.2.3.4 *.bad.example",
      "",
      "# Claude AI",
      "159.194.200.33 a.example",
      "193.233.112.67 a.example",
      "193.233.112.68 b.example c.example",
      "garbage",
      ""
    );

    expect(summarizeHosts(parseHosts(text))).toEqual({
      lines: 15,
      entries: 9,
      overridableEntries: 3,
      overridableHostnames: 3,
      unresolvableHostnames: 0,
      blockingEntries: 4,
      ipv6Entries: 1,
      invalidEntries: 1,
      commentLines: 3,
      blankLines: 2
    });
  });
});
