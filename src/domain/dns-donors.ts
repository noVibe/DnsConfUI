/** A DNS proxy the app can offer: the presets below, and the ones a user adds while the container runs. */
export type DnsDonor = { readonly label: string; readonly value: string; readonly site?: string };

export const DNS_DONORS: readonly DnsDonor[] = [
  { label: "GeoHide RU", value: "https://geohide.ru/dns-query", site: "https://geohide.ru" },
  { label: "GeoHide EU", value: "https://eu.geohide.ru/dns-query", site: "https://geohide.ru" },
  { label: "GeoHide US", value: "https://us.geohide.ru/dns-query", site: "https://geohide.ru" },
  { label: "Comss", value: "https://dns.comss.one/dns-query", site: "https://www.comss.ru/page.php?id=7315" },
  // Its own site publishes this address: dns.magicdns.ru no longer resolves, and magicdns.ru is only the page.
  { label: "MagicDNS", value: "https://api.magicinfo.art/rpc", site: "https://magicdns.ru" },
  { label: "Bezmezhau", value: "https://dns.bezmezhau.com/dns-query", site: "https://bezmezhau.com/en" },
  { label: "WLRUS", value: "https://dns.wlrus.cfd/dns-query", site: "https://site.dns.wlrus.cfd" },
  { label: "Malw", value: "https://dns.malw.link/dns-query", site: "https://info.dns.malw.link" },
  { label: "Dagami", value: "https://dns.dagami.ru/dns-query", site: "https://dns.dagami.ru" },
  { label: "DNS-AI", value: "https://dns.dns-ai.ru/dns-query", site: "https://dns-ai.ru" }
];

export const DEFAULT_DNS_DONOR = DNS_DONORS[0].value;
export const DISABLED_DNS_DONOR = "-";

export function isDnsDonorPreset(value: string): boolean {
  return DNS_DONORS.some((donor) => donor.value === value);
}

/** A URL longer than this is not a DoH endpoint anyone typed; it is a payload. */
const MAX_DONOR_URL_LENGTH = 2048;

/**
 * Whether a donor may be contacted at all: a preset, or any HTTPS DoH URL a user
 * wants to try. Credentials in the URL are refused so a donor can never carry
 * someone's basic-auth header outbound, and `resolveA` additionally refuses
 * servers that resolve to a non-public address.
 *
 * Shared by every route that takes a donor from the client, so the answer cannot
 * drift between them.
 */
export function isCheckableDonor(value: string): boolean {
  if (isDnsDonorPreset(value)) return true;
  if (value.length > MAX_DONOR_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function getDnsDonorLabel(value: string): string | undefined {
  return DNS_DONORS.find((donor) => donor.value === value)?.label;
}

// ChatGPT is not available from these countries, so a connection exiting there does not help.
export const BLOCKED_COUNTRIES: ReadonlySet<string> = new Set(["RU", "BY"]);
