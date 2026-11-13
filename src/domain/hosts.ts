/**
 * Pure parsing and rewriting of published "hosts" files.
 *
 * A published list pins every domain to an IP that worked when the list was
 * built. We re-resolve the overridable domains through a chosen DNS proxy and
 * rewrite the file in place, so the result stays recognisable as the original
 * file: every comment, blank line and untouched entry keeps its bytes and its
 * position, and the file keeps its own line ending.
 *
 * No I/O lives here; fetching and resolving happen elsewhere.
 */

export type HostsLineEnding = "\r\n" | "\n";

/**
 * How an entry line is treated by a run:
 * - `overridable` - re-resolved and rewritten.
 * - `blocking`    - an ad/tracker sink or a loopback pin (0.0.0.0,
 *                   127.0.0.0/8, 255.255.255.255, `::`, `::1`). Never touched.
 * - `ipv6`        - any other IPv6 address. The resolver only asks for A
 *                   records, so an AAAA pin can never be refreshed here.
 * - `invalid`     - the IP is fine but at least one hostname on the line is not
 *                   a plausible DNS name. Uploaded files may be hostile or
 *                   broken, so such a line is passed through verbatim rather
 *                   than reformatted.
 */
export type HostsEntryClass = "overridable" | "blocking" | "ipv6" | "invalid";

export type HostsBlankLine = { readonly kind: "blank"; readonly raw: string };

export type HostsCommentLine = { readonly kind: "comment"; readonly raw: string };

/** A line that is neither blank, nor a comment, nor `IP hostname...`. */
export type HostsUnparsedLine = { readonly kind: "unparsed"; readonly raw: string };

export type HostsEntryLine = {
  readonly kind: "entry";
  readonly raw: string;
  readonly ip: string;
  readonly hostnames: readonly string[];
  /** Trailing inline comment including its leading `#`, if the line has one. */
  readonly comment?: string;
  readonly entryClass: HostsEntryClass;
};

export type HostsLine = HostsBlankLine | HostsCommentLine | HostsUnparsedLine | HostsEntryLine;

export type ParsedHostsFile = {
  /** Every original line, in order, without its terminator. */
  readonly lines: readonly HostsLine[];
  readonly lineEnding: HostsLineEnding;
  readonly endsWithNewline: boolean;
};

/** hostname -> freshly resolved IPv4 address. Hostname keys are case-insensitive. */
export type HostsOverrides = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

export type HostsSummary = {
  readonly lines: number;
  readonly entries: number;
  readonly overridableEntries: number;
  readonly overridableHostnames: number;
  /**
   * Distinct hostnames on overridable entries that no public resolver can be
   * asked about (a single label, such as `localhost`). Their lines are legal and
   * are passed through unchanged, so a run reports them as kept rather than
   * leaving the UI to work the number out for itself.
   */
  readonly unresolvableHostnames: number;
  readonly blockingEntries: number;
  readonly ipv6Entries: number;
  readonly invalidEntries: number;
  readonly commentLines: number;
  readonly blankLines: number;
};

const BLOCKING_IPS: ReadonlySet<string> = new Set(["0.0.0.0", "255.255.255.255", "::", "::1"]);

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/;

/** One DNS label: letters, digits, `_` and inner `-`, at most 63 characters. */
const HOSTNAME_LABEL = /^[A-Za-z0-9_]([A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/;

export function isIpv4Address(value: string): boolean {
  const match = IPV4.exec(value);
  return match !== null && match.slice(1).every((octet) => Number(octet) <= 255);
}

export function isIpv6Address(value: string): boolean {
  if (!value.includes(":")) return false;
  const halves = value.split("::");
  if (halves.length > 2) return false;
  const split = (half: string) => (half === "" ? [] : half.split(":"));
  let groups = [...split(halves[0]), ...(halves.length === 2 ? split(halves[1]) : [])];
  let expected = 8;
  const last = groups[groups.length - 1];
  if (last !== undefined && last.includes(".")) {
    // IPv4-mapped tail, e.g. ::ffff:192.0.2.1
    if (!isIpv4Address(last)) return false;
    groups = groups.slice(0, -1);
    expected = 6;
  }
  if (!groups.every((group) => IPV6_GROUP.test(group))) return false;
  // `::` stands for at least one omitted group.
  return halves.length === 2 ? groups.length < expected : groups.length === expected;
}

export function isIpAddress(value: string): boolean {
  return isIpv4Address(value) || isIpv6Address(value);
}

/**
 * Whether a token can be asked of a DNS resolver at all. Deliberately strict:
 * an uploaded list is untrusted input, and anything we cannot vouch for is
 * copied through untouched instead of being rewritten.
 */
export function isPlausibleHostname(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  if (isIpAddress(value)) return false;
  const name = value.endsWith(".") ? value.slice(0, -1) : value;
  if (name.length === 0) return false;
  return name.split(".").every((label) => HOSTNAME_LABEL.test(label));
}

/**
 * Whether a public DNS resolver can be asked about this name at all.
 *
 * Deliberately a separate question from `isPlausibleHostname`: `localhost` or
 * `myserver` is a perfectly legal hosts entry and its line must survive a run
 * untouched, but no public DoH server can answer for a single-label name. The
 * rules here are the ones the DNS query itself imposes - at least two labels, at
 * most 253 characters in total and 63 per label - so a name that passes this can
 * be handed to the resolve route, and one that does not never leaves the client.
 */
export function isResolvableHostname(value: string): boolean {
  if (value.length > 253) return false;
  const labels = value.split(".");
  return labels.length >= 2 && labels.every((label) => HOSTNAME_LABEL.test(label));
}

/** A sink or loopback pin: meaningful as written, so never re-resolved. */
export function isBlockingIp(value: string): boolean {
  if (BLOCKING_IPS.has(value)) return true;
  return isIpv4Address(value) && value.startsWith("127.");
}

function classifyEntry(ip: string, hostnames: readonly string[]): HostsEntryClass {
  if (isBlockingIp(ip)) return "blocking";
  if (isIpv6Address(ip)) return "ipv6";
  if (!hostnames.every(isPlausibleHostname)) return "invalid";
  return "overridable";
}

function parseLine(raw: string): HostsLine {
  if (raw.trim() === "") return { kind: "blank", raw };
  if (raw.trimStart().startsWith("#")) return { kind: "comment", raw };

  const hash = raw.indexOf("#");
  const body = hash === -1 ? raw : raw.slice(0, hash);
  const comment = hash === -1 ? undefined : raw.slice(hash).trimEnd();
  const tokens = body.trim().split(/\s+/).filter((token) => token !== "");
  const [ip, ...hostnames] = tokens;
  if (ip === undefined || hostnames.length === 0 || !isIpAddress(ip)) {
    return { kind: "unparsed", raw };
  }
  const entry: HostsEntryLine = {
    kind: "entry",
    raw,
    ip,
    hostnames,
    entryClass: classifyEntry(ip, hostnames)
  };
  return comment === undefined ? entry : { ...entry, comment };
}

/**
 * Split a hosts file into lines, keeping each original line verbatim.
 *
 * The line ending is taken from the first terminator in the file; a file with
 * mixed endings is therefore normalised to that one when it is written back.
 */
export function parseHosts(text: string): ParsedHostsFile {
  const firstBreak = text.indexOf("\n");
  const lineEnding: HostsLineEnding = firstBreak > 0 && text[firstBreak - 1] === "\r" ? "\r\n" : "\n";
  const endsWithNewline = text.endsWith("\n");
  const body = endsWithNewline ? text.slice(0, text.endsWith("\r\n") ? -2 : -1) : text;
  const lines = body === "" && !endsWithNewline ? [] : body.split(/\r?\n/).map(parseLine);
  return { lines, lineEnding, endsWithNewline };
}

/**
 * Distinct hostnames on overridable entries, in order of first appearance, split
 * by whether a public resolver can be asked about them. Matching is
 * case-insensitive; the first spelling is kept.
 */
function splitOverridableHostnames(parsed: ParsedHostsFile): { resolvable: string[]; unresolvable: string[] } {
  const seen = new Set<string>();
  const resolvable: string[] = [];
  const unresolvable: string[] = [];
  for (const line of parsed.lines) {
    if (line.kind !== "entry" || line.entryClass !== "overridable") continue;
    for (const hostname of line.hostnames) {
      const key = hostname.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      (isResolvableHostname(hostname) ? resolvable : unresolvable).push(hostname);
    }
  }
  return { resolvable, unresolvable };
}

/**
 * Distinct hostnames that a run should re-resolve, in order of first
 * appearance. Matching is case-insensitive; the first spelling is kept.
 *
 * A legal entry whose name no public resolver can answer for (`localhost` and
 * other single-label names) is left out, so nothing here can be refused by the
 * resolve route; `summarizeHosts` counts those names instead.
 */
export function overridableHostnames(parsed: ParsedHostsFile): string[] {
  return splitOverridableHostnames(parsed).resolvable;
}

export function summarizeHosts(parsed: ParsedHostsFile): HostsSummary {
  let entries = 0;
  let overridableEntries = 0;
  let blockingEntries = 0;
  let ipv6Entries = 0;
  let invalidEntries = 0;
  let commentLines = 0;
  let blankLines = 0;

  for (const line of parsed.lines) {
    if (line.kind === "comment") commentLines += 1;
    else if (line.kind === "blank") blankLines += 1;
    else if (line.kind === "entry") {
      entries += 1;
      if (line.entryClass === "overridable") overridableEntries += 1;
      else if (line.entryClass === "blocking") blockingEntries += 1;
      else if (line.entryClass === "ipv6") ipv6Entries += 1;
      else invalidEntries += 1;
    }
  }

  const names = splitOverridableHostnames(parsed);
  return {
    lines: parsed.lines.length,
    entries,
    overridableEntries,
    overridableHostnames: names.resolvable.length,
    unresolvableHostnames: names.unresolvable.length,
    blockingEntries,
    ipv6Entries,
    invalidEntries,
    commentLines,
    blankLines
  };
}

/**
 * Only IPv4 answers are accepted: the resolver asks for A records, and an
 * unusable value (empty, a hostname, an IPv6 address) must leave the original
 * lines alone rather than write something broken into the file.
 */
function toOverrideMap(resolved: HostsOverrides): Map<string, string> {
  const pairs: Iterable<readonly [string, string]> =
    resolved instanceof Map
      ? (resolved as ReadonlyMap<string, string>)
      : Object.entries(resolved as Record<string, string>);
  const overrides = new Map<string, string>();
  for (const [hostname, ip] of pairs) {
    if (typeof hostname !== "string" || typeof ip !== "string") continue;
    const address = ip.trim();
    if (!isIpv4Address(address)) continue;
    overrides.set(hostname.trim().toLowerCase(), address);
  }
  return overrides;
}

type OutputGroup = { ip: string; hostnames: string[] };

function addToGroup(groups: OutputGroup[], ip: string, hostname: string): void {
  const group = groups.find((candidate) => candidate.ip === ip);
  if (group) group.hostnames.push(hostname);
  else groups.push({ ip, hostnames: [hostname] });
}

/**
 * Rewrite the file with the freshly resolved addresses.
 *
 * - A hostname that got a new IP collapses to a single line at the position of
 *   its first overridable entry; its other entries are dropped. This is the
 *   point of the exercise for lists that repeat every hostname once per proxy
 *   IP.
 * - A hostname with no usable new IP keeps all of its original lines, byte for
 *   byte.
 * - Comments, blank lines, unparsed lines, blocking entries, IPv6 entries and
 *   implausible hostnames pass through untouched and in place.
 * - A line with several hostnames is regrouped rather than duplicated: the
 *   hostnames it still owns are bucketed by their new address, so one line is
 *   emitted per distinct address (plus one carrying any hostname that was not
 *   resolved, with the original IP). Grouping keeps the file as short as a
 *   single-hostname collapse would, and never moves a hostname to a line it did
 *   not start on. An inline comment is kept on the first line of the group.
 * - A rewritten line is written canonically as `IP hostname[ hostname...][ #
 *   comment]`; original indentation and separator runs only survive on lines
 *   that are passed through.
 * - The original line ending and trailing-newline state are preserved.
 */
export function applyOverrides(parsed: ParsedHostsFile, resolved: HostsOverrides): string {
  const overrides = toOverrideMap(resolved);
  const claimed = new Set<string>();
  const out: string[] = [];

  for (const line of parsed.lines) {
    if (line.kind !== "entry" || line.entryClass !== "overridable") {
      out.push(line.raw);
      continue;
    }

    const groups: OutputGroup[] = [];
    let rewritten = false;
    for (const hostname of line.hostnames) {
      const key = hostname.toLowerCase();
      const address = overrides.get(key);
      if (address === undefined) {
        addToGroup(groups, line.ip, hostname);
        continue;
      }
      rewritten = true;
      // A repeat of a hostname already emitted above: its line goes away.
      if (claimed.has(key)) continue;
      claimed.add(key);
      addToGroup(groups, address, hostname);
    }

    if (!rewritten) {
      out.push(line.raw);
      continue;
    }
    const suffix = line.comment === undefined ? "" : ` ${line.comment}`;
    groups.forEach((group, index) => {
      out.push(`${group.ip} ${group.hostnames.join(" ")}${index === 0 ? suffix : ""}`);
    });
  }

  const text = out.join(parsed.lineEnding);
  return parsed.endsWithNewline && out.length > 0 ? text + parsed.lineEnding : text;
}
