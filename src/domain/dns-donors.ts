export type DnsDonor = {
  readonly slug: string;
  readonly label: string;
  readonly value: string;
  readonly site?: string;
};

export const DNS_DONORS: readonly DnsDonor[] = [
  { slug: "geohide-ru", label: "GeoHide RU", value: "https://geohide.ru/dns-query", site: "https://geohide.ru" },
  { slug: "geohide-eu", label: "GeoHide EU", value: "https://eu.geohide.ru/dns-query", site: "https://geohide.ru" },
  { slug: "geohide-us", label: "GeoHide US", value: "https://us.geohide.ru/dns-query", site: "https://geohide.ru" },
  { slug: "comss", label: "Comss", value: "https://dns.comss.one/dns-query", site: "https://www.comss.ru/page.php?id=7315" },
  { slug: "magicdns", label: "MagicDNS", value: "https://dns.magicdns.ru/dns-query", site: "https://magicdns.ru" },
  { slug: "bezmezhau", label: "Bezmezhau", value: "https://dns.bezmezhau.com/dns-query", site: "https://bezmezhau.com/en" },
  { slug: "wlrus", label: "WLRUS", value: "https://dns.wlrus.cfd/dns-query", site: "https://site.dns.wlrus.cfd" },
  { slug: "malw", label: "Malw", value: "https://dns.malw.link/dns-query", site: "https://info.dns.malw.link" },
  { slug: "dagami", label: "Dagami", value: "https://dns.dagami.ru/dns-query", site: "https://dns.dagami.ru" },
  { slug: "dns-ai", label: "DNS-AI", value: "https://dns.dns-ai.ru/dns-query", site: "https://dns-ai.ru" },
  { slug: "zapret", label: "Zapret", value: "https://dns.zapret.moe/dns-query", site: "https://dns.zapret.moe" }
];

export const DEFAULT_DNS_DONOR = DNS_DONORS[0].value;
export const DEFAULT_DNS_DONOR_SLUG = DNS_DONORS[0].slug;
export const DISABLED_DNS_DONOR = "-";

export function normalizeDonorSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.txt$/i, "");
}

export function getDnsDonorBySlug(raw: string): DnsDonor | undefined {
  const slug = normalizeDonorSlug(raw);
  return DNS_DONORS.find((donor) => donor.slug === slug);
}

export function isDnsDonorPreset(value: string): boolean {
  return DNS_DONORS.some((donor) => donor.value === value);
}

export function getDnsDonorLabel(value: string): string | undefined {
  return DNS_DONORS.find((donor) => donor.value === value)?.label;
}

// ChatGPT is not available from these countries, so a connection exiting there does not help.
export const BLOCKED_COUNTRIES: ReadonlySet<string> = new Set(["RU", "BY"]);
