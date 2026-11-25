import { domainToASCII } from "node:url";
import { isPublicAddress } from "@/lib/dns/doh";

const LOCALHOST_NAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback", "localdomain"]);
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$|^[a-z0-9]$/;

export type HostsOverrideEntry = {
  domain: string;
  ips: string[];
};

/**
 * Normalizes a hostname to ASCII Punycode lowercase without a trailing dot.
 * Returns null if the input is not a valid DNS hostname usable in AdGuard rules.
 */
export function normalizeDomain(raw: string, options: { stripWww?: boolean } = {}): string | null {
  let cleaned = raw.trim().toLowerCase().replace(/\.+$/, "");
  if (!cleaned || cleaned.includes("://") || cleaned.includes("/") || cleaned.includes("*")) {
    return null;
  }
  if (options.stripWww && cleaned.startsWith("www.")) {
    cleaned = cleaned.slice(4);
  }
  if (!cleaned || LOCALHOST_NAMES.has(cleaned)) {
    return null;
  }
  const ascii = domainToASCII(cleaned).toLowerCase().replace(/\.+$/, "");
  if (!ascii || ascii.length > 253 || !ascii.includes(".")) {
    return null;
  }
  const labels = ascii.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63 || !LABEL_PATTERN.test(label))) {
    return null;
  }
  return ascii;
}

/**
 * Parses a hosts file and extracts only override entries pointing to public IP addresses.
 * Deduplicates IPs per domain while preserving source order.
 */
export function parseHostsOverrides(text: string): HostsOverrideEntry[] {
  const byDomain = new Map<string, string[]>();
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
    const withoutComment = trimmed.replace(/[#].*$/, "").trim();
    if (!withoutComment) continue;

    const parts = withoutComment.split(/\s+/);
    if (parts.length < 2) continue;

    const ip = parts[0];
    if (!isPublicAddress(ip)) continue;

    for (let i = 1; i < parts.length; i++) {
      const domain = normalizeDomain(parts[i], { stripWww: false });
      if (!domain) continue;
      let ips = byDomain.get(domain);
      if (!ips) {
        ips = [];
        byDomain.set(domain, ips);
      }
      if (!ips.includes(ip)) {
        ips.push(ip);
      }
    }
  }

  return [...byDomain.entries()].map(([domain, ips]) => ({ domain, ips }));
}

export function countDots(domain: string): number {
  let count = 0;
  for (let i = 0; i < domain.length; i++) {
    if (domain.charCodeAt(i) === 46) count++;
  }
  return count;
}

/**
 * Returns true if `domain` is a strict subdomain of any domain in `parents`.
 * Label-aware: `ample.com` never matches `example.com`.
 */
export function findClosestParent(domain: string, parents: ReadonlySet<string>): string | null {
  for (let dot = domain.indexOf("."); dot >= 0; dot = domain.indexOf(".", dot + 1)) {
    const candidate = domain.slice(dot + 1);
    if (parents.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Port of DnsConf's HostsCompressor: drops duplicates and subdomains covered by a parent domain in the list.
 * Parents are kept first so subdomains do not need separate rules when using subdomain matching (`||domain^`).
 */
export function compressDomains(domains: Iterable<string>): string[] {
  const unique = [...new Set(domains)].sort((a, b) => countDots(a) - countDots(b) || a.localeCompare(b));
  const kept = new Set<string>();
  for (const domain of unique) {
    if (!findClosestParent(domain, kept)) {
      kept.add(domain);
    }
  }
  return [...kept].sort((a, b) => a.localeCompare(b));
}

function compareIpAddresses(a: string, b: string): number {
  const partsA = a.split(".");
  const partsB = b.split(".");
  if (partsA.length === 4 && partsB.length === 4) {
    for (let i = 0; i < 4; i++) {
      const diff = Number(partsA[i]) - Number(partsB[i]);
      if (diff !== 0 && !Number.isNaN(diff)) return diff;
    }
  }
  return a.localeCompare(b);
}

/**
 * Multi-IP sticky selector (generalization of DonorDnsUtils.chooseIp):
 * Keeps previously selected IPs that are still returned by the donor in their previous order
 * so generated files and ETags stay stable across round-robin DNS answers, then fills up to `maxIps`.
 */
export function chooseStickyIps(
  previousIps: readonly string[],
  freshIps: readonly string[],
  maxIps: number
): string[] {
  const freshUnique = [...new Set(freshIps.filter(isPublicAddress))];
  if (freshUnique.length === 0 || maxIps <= 0) return [];

  const freshSet = new Set(freshUnique);
  const chosen: string[] = [];

  for (const prev of previousIps) {
    if (chosen.length >= maxIps) break;
    if (freshSet.has(prev) && !chosen.includes(prev)) {
      chosen.push(prev);
    }
  }

  const remaining = freshUnique.filter((ip) => !chosen.includes(ip)).sort(compareIpAddresses);
  for (const ip of remaining) {
    if (chosen.length >= maxIps) break;
    chosen.push(ip);
  }

  return chosen;
}
