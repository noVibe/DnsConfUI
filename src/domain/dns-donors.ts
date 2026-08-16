export const DNS_DONORS = [
  { label: "GeoHide", value: "https://dns.geohide.ru:444/dns-query" },
  { label: "Xbox", value: "https://xbox-dns.ru/dns-query" },
  { label: "Comss", value: "https://dns.comss.one/dns-query" }
] as const;

export const DEFAULT_DNS_DONOR = DNS_DONORS[0].value;
export const DISABLED_DNS_DONOR = "-";

export function isDnsDonorPreset(value: string): boolean {
  return DNS_DONORS.some((donor) => donor.value === value);
}

export function getDnsDonorLabel(value: string): string | undefined {
  return DNS_DONORS.find((donor) => donor.value === value)?.label;
}
