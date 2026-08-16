import type { DnsConfConfig } from "./dnsconf-config";
import { DISABLED_DNS_DONOR } from "./dns-donors";

export const DNSCONF_VARIABLE_NAMES = [
  "DNS",
  "DONOR_DNS",
  "BLOCK",
  "REDIRECT",
  "EXCLUDE_REDIRECT"
] as const;

export type DnsConfVariableName = typeof DNSCONF_VARIABLE_NAMES[number];
export type DnsConfVariables = Partial<Record<DnsConfVariableName, string>>;

export function configFromDnsConfVariables(variables: DnsConfVariables): DnsConfConfig | null {
  const providers = splitCommaValues(variables.DNS).map((value) => value.toLowerCase());
  if (providers.length === 0 || providers.some((provider) => provider !== "cloudflare" && provider !== "nextdns")) {
    return null;
  }

  const donors = splitCommaValues(variables.DONOR_DNS, true);
  const profiles = providers.map((provider, index) => ({
    clientId: "",
    authSecret: "",
    provider: provider as "cloudflare" | "nextdns",
    donorDns: donorForProfile(donors[index])
  }));

  return {
    profiles,
    blocklists: splitSourceValues(variables.BLOCK),
    redirects: splitSourceValues(variables.REDIRECT),
    redirectExclusions: splitSourceValues(variables.EXCLUDE_REDIRECT)
  };
}

function donorForProfile(value: string | undefined): string {
  if (value === DISABLED_DNS_DONOR) return "";
  return value || "";
}

function splitCommaValues(value: string | undefined, preserveEmpty = false): string[] {
  if (!value) return [];
  const values = value.split(",").map((part) => part.trim());
  return preserveEmpty ? values : values.filter(Boolean);
}

function splitSourceValues(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
}
