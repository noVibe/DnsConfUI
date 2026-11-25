import { createHash } from "node:crypto";
import type { AdGuardFilterOptions } from "@/domain/adguard-sources";
import { isPublicAddress } from "@/lib/dns/doh";
import { countDots, findClosestParent, normalizeDomain, type HostsOverrideEntry } from "./hosts-parser";

const MAX_RULE_LINE_LENGTH = 900;

export type CompileFilterInput = {
  title: string;
  description: string;
  homepage: string;
  updatedAt: string;
  entries: readonly HostsOverrideEntry[];
  options: AdGuardFilterOptions;
};

export type CompiledAdGuardFilter = {
  text: string;
  etag: string;
  rulesCount: number;
  domainsCount: number;
  compressedDomainsCount: number;
};

type KeptNode = {
  domain: string;
  ips: string[];
  /** Exclusions that must not inherit this parent's IPs: user exclusions & different-IP subdomains. */
  requiredExclusions: Set<string>;
  /** Same-IP children kept explicitly when `compress=false` (never safe to turn into `@@` rules). */
  sameIpChildren: Set<string>;
  /** IPs already provided by an ancestor rule without an `@@` carve-out (avoids duplicate A records). */
  inheritedIps: Set<string>;
};

function isExcluded(domain: string, excludeSet: ReadonlySet<string>): boolean {
  return excludeSet.has(domain) || findClosestParent(domain, excludeSet) !== null;
}

function sameIpSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((ip) => setA.has(ip));
}

function fitsDenyallowLine(domain: string, ips: readonly string[], denyallowList: readonly string[]): boolean {
  if (denyallowList.length === 0) return true;
  const maxIpLen = ips.reduce((max, ip) => Math.max(max, ip.length), 0);
  const denyallowParam = denyallowList.join("|");
  // `||${domain}^$dnsrewrite=${ip},denyallow=${denyallowParam}`
  const totalLen = 2 + domain.length + 13 + maxIpLen + 11 + denyallowParam.length;
  return totalLen <= MAX_RULE_LINE_LENGTH;
}

function isDomainOrDescendantWantingIp(
  targetDomain: string,
  ip: string,
  keptNodes: ReadonlyMap<string, KeptNode>
): boolean {
  const direct = keptNodes.get(targetDomain);
  if (direct?.ips.includes(ip)) return true;
  const suffix = `.${targetDomain}`;
  for (const [domain, node] of keptNodes) {
    if (domain.endsWith(suffix) && node.ips.includes(ip)) {
      return true;
    }
  }
  return false;
}

/**
 * Compiles normalized domain -> proxy IP mappings into a universal AdGuard `$dnsrewrite` filter list.
 * Compatible with AdGuard Home, AdGuard for Android, iOS (AdGuard VPN mode), Windows and macOS (`DnsLibs`).
 */
export function compileAdGuardFilter(input: CompileFilterInput): CompiledAdGuardFilter {
  const { options } = input;

  const excludeSet = new Set<string>();
  for (const raw of options.exclude) {
    const normalized = normalizeDomain(raw, { stripWww: false });
    if (normalized) excludeSet.add(normalized);
  }

  // Deduplicate domains preserving source priority (first occurrence wins).
  // `www.` is preserved rather than blindly stripped: when apex & `www.` share IPs, subdomain compression merges them cleanly.
  const normalizedMap = new Map<string, string[]>();
  for (const entry of input.entries) {
    const domain = normalizeDomain(entry.domain, { stripWww: false });
    if (!domain || normalizedMap.has(domain)) continue;
    if (isExcluded(domain, excludeSet)) continue;

    const ips: string[] = [];
    for (const ip of entry.ips) {
      if (ips.length >= options.maxIps) break;
      if (isPublicAddress(ip) && !ips.includes(ip)) {
        ips.push(ip);
      }
    }
    if (ips.length > 0) {
      normalizedMap.set(domain, ips);
    }
  }

  const domainsCount = normalizedMap.size;
  const ruleLines: string[] = [];
  let compressedDomainsCount = domainsCount;

  if (options.mode === "exact") {
    const sortedDomains = [...normalizedMap.keys()].sort((a, b) => a.localeCompare(b));
    for (const domain of sortedDomains) {
      const ips = normalizedMap.get(domain)!;
      for (const ip of ips) {
        ruleLines.push(`|${domain}^$dnsrewrite=${ip}`);
      }
    }
  } else {
    // Sort parents before children so every subdomain can inspect its closest kept ancestor.
    const sortedByDepth = [...normalizedMap.entries()].sort(
      ([a], [b]) => countDots(a) - countDots(b) || a.localeCompare(b)
    );

    const keptNodes = new Map<string, KeptNode>();
    const keptSet = new Set<string>();

    for (const [domain, ips] of sortedByDepth) {
      const parentDomain = findClosestParent(domain, keptSet);
      if (!parentDomain) {
        keptNodes.set(domain, {
          domain,
          ips,
          requiredExclusions: new Set(),
          sameIpChildren: new Set(),
          inheritedIps: new Set()
        });
        keptSet.add(domain);
        continue;
      }

      const parent = keptNodes.get(parentDomain)!;
      if (sameIpSet(ips, parent.ips)) {
        if (options.compress) {
          // Covered cleanly by `||parent^` with identical proxy IPs.
          continue;
        }
        // Without compression, exclude child from parent via `denyallow` so AdGuard does not duplicate A records.
        parent.sameIpChildren.add(domain);
        keptNodes.set(domain, {
          domain,
          ips,
          requiredExclusions: new Set(),
          sameIpChildren: new Set(),
          inheritedIps: new Set()
        });
        keptSet.add(domain);
      } else {
        // Different proxy IPs on a subdomain: carve out the subdomain from the parent so IPs never mix.
        parent.requiredExclusions.add(domain);
        keptNodes.set(domain, {
          domain,
          ips,
          requiredExclusions: new Set(),
          sameIpChildren: new Set(),
          inheritedIps: new Set()
        });
        keptSet.add(domain);
      }
    }

    // Apply user exclusions that fall beneath a kept parent rule (e.g., `||example.com^` + exclude `direct.example.com`).
    for (const excluded of excludeSet) {
      const parentDomain = findClosestParent(excluded, keptSet);
      if (parentDomain) {
        keptNodes.get(parentDomain)!.requiredExclusions.add(excluded);
      }
    }

    // Process parents before children when deciding line-length fallbacks so inherited IPs propagate cleanly.
    const nodesByDepth = [...keptNodes.values()].sort(
      (a, b) => countDots(a.domain) - countDots(b.domain) || a.domain.localeCompare(b.domain)
    );

    const linesByDomain = new Map<string, string[]>();

    for (const node of nodesByDepth) {
      if (!keptNodes.has(node.domain)) continue;

      const ipsToEmit = node.ips.filter((ip) => !node.inheritedIps.has(ip));
      if (ipsToEmit.length === 0) continue;

      const combinedDenyallow = [...new Set([...node.requiredExclusions, ...node.sameIpChildren])].sort((a, b) =>
        a.localeCompare(b)
      );

      if (fitsDenyallowLine(node.domain, ipsToEmit, combinedDenyallow)) {
        if (combinedDenyallow.length === 0) {
          linesByDomain.set(
            node.domain,
            ipsToEmit.map((ip) => `||${node.domain}^$dnsrewrite=${ip}`)
          );
        } else {
          const denyallowParam = combinedDenyallow.join("|");
          linesByDomain.set(
            node.domain,
            ipsToEmit.map((ip) => `||${node.domain}^$dnsrewrite=${ip},denyallow=${denyallowParam}`)
          );
        }
        continue;
      }

      // Line would exceed client limits: first collapse `sameIpChildren` (from `compress=false`) into the parent
      // rather than emitting self-cancelling `@@||child^$dnsrewrite=IP` exceptions.
      if (node.sameIpChildren.size > 0) {
        const queue = [...node.sameIpChildren];
        node.sameIpChildren.clear();
        while (queue.length > 0) {
          const childDomain = queue.shift()!;
          const child = keptNodes.get(childDomain);
          if (!child) continue;
          for (const req of child.requiredExclusions) {
            node.requiredExclusions.add(req);
          }
          for (const nestedSame of child.sameIpChildren) {
            queue.push(nestedSame);
          }
          keptNodes.delete(childDomain);
        }
      }

      const requiredList = [...node.requiredExclusions].sort((a, b) => a.localeCompare(b));
      if (fitsDenyallowLine(node.domain, ipsToEmit, requiredList)) {
        if (requiredList.length === 0) {
          linesByDomain.set(
            node.domain,
            ipsToEmit.map((ip) => `||${node.domain}^$dnsrewrite=${ip}`)
          );
        } else {
          const denyallowParam = requiredList.join("|");
          linesByDomain.set(
            node.domain,
            ipsToEmit.map((ip) => `||${node.domain}^$dnsrewrite=${ip},denyallow=${denyallowParam}`)
          );
        }
        continue;
      }

      // Fallback for very long required exclusion lists: emit `@@` exceptions only for IPs not wanted by the target
      // (or its descendants), so an exception rule never cancels a valid child rewrite sharing that IP.
      const lines = ipsToEmit.map((ip) => `||${node.domain}^$dnsrewrite=${ip}`);
      for (const excluded of requiredList) {
        const excludedNode = keptNodes.get(excluded);
        for (const ip of ipsToEmit) {
          if (isDomainOrDescendantWantingIp(excluded, ip, keptNodes)) {
            if (excludedNode?.ips.includes(ip)) {
              excludedNode.inheritedIps.add(ip);
            }
            continue;
          }
          lines.push(`@@||${excluded}^$dnsrewrite=${ip}`);
        }
      }
      linesByDomain.set(node.domain, lines);
    }

    compressedDomainsCount = keptNodes.size;
    const sortedDomains = [...linesByDomain.keys()].sort((a, b) => a.localeCompare(b));
    for (const domain of sortedDomains) {
      ruleLines.push(...linesByDomain.get(domain)!);
    }
  }

  const rulesBody = ruleLines.join("\n");
  const versionHash = createHash("sha256").update(rulesBody, "utf8").digest("hex").slice(0, 12);

  const headerLines = [
    `! Title: ${input.title}`,
    `! Description: ${input.description}`,
    `! Version: ${versionHash}`,
    `! Homepage: ${input.homepage}`,
    "! Expires: 6 hours",
    `! Last modified: ${input.updatedAt}`,
    `! Rules: ${ruleLines.length}`,
    "!"
  ];

  const text = `${headerLines.join("\n")}\n${rulesBody}${rulesBody ? "\n" : ""}`;
  // Hash canonical content (independent of request-derived homepage header) so ETags stay stable across hosts/proxies.
  const etagInput = `${input.title}\n${input.description}\n${input.updatedAt}\n${rulesBody}`;
  const etag = `"${createHash("sha256").update(etagInput, "utf8").digest("hex").slice(0, 24)}"`;

  return {
    text,
    etag,
    rulesCount: ruleLines.length,
    domainsCount,
    compressedDomainsCount
  };
}
