import type { DnsConfConfig } from "./dnsconf-config";
import { DEFAULT_DNS_DONOR, DISABLED_DNS_DONOR } from "./dns-donors";

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
  const providers = splitValues(variables.DNS).map((value) => value.toLowerCase());
  if (providers.length === 0 || providers.some((provider) => provider !== "cloudflare" && provider !== "nextdns")) {
    return null;
  }

  const donors = splitValues(variables.DONOR_DNS, true);
  const profiles = providers.map((provider, index) => ({
    clientId: "",
    authSecret: "",
    provider: provider as "cloudflare" | "nextdns",
    donorDns: donorForProfile(donors[index])
  }));

  return {
    profiles,
    blocklists: splitValues(variables.BLOCK),
    redirects: splitValues(variables.REDIRECT),
    redirectExclusions: splitValues(variables.EXCLUDE_REDIRECT)
  };
}

function donorForProfile(value: string | undefined): string {
  if (value === DISABLED_DNS_DONOR) return "";
  return value || DEFAULT_DNS_DONOR;
}

function splitValues(value: string | undefined, preserveEmpty = false): string[] {
  if (!value) return [];
  const values = value.split(",").map((part) => part.trim());
  return preserveEmpty ? values : values.filter(Boolean);
}
