export type HostsSource = {
  key: string;
  label: string;
  /** The published file itself, not a page about it. */
  url: string;
  /** Byte-identical fallback, tried when the primary URL is unreachable. */
  mirror?: string;
  site?: string;
};

export const HOSTS_SOURCES = [
  {
    key: "geohide",
    label: "GeoHide",
    url: "https://geohide.ru/hosts",
    mirror: "https://raw.githubusercontent.com/Internet-Helper/GeoHideDNS/refs/heads/main/hosts/hosts",
    site: "https://geohide.ru"
  },
  {
    // https://info.dns.malw.link/hosts is a help page, not the file.
    key: "malw",
    label: "Malw",
    url: "https://raw.githubusercontent.com/ImMALWARE/dns.malw.link/master/hosts",
    site: "https://info.dns.malw.link/hosts"
  }
] as const satisfies readonly HostsSource[];

export type HostsSourceKey = (typeof HOSTS_SOURCES)[number]["key"];

export const DEFAULT_HOSTS_SOURCE: HostsSourceKey = "geohide";

export function isHostsSourceKey(value: string): value is HostsSourceKey {
  return HOSTS_SOURCES.some((source) => source.key === value);
}

export function getHostsSource(key: string): HostsSource | undefined {
  return HOSTS_SOURCES.find((source) => source.key === key);
}

export function getHostsSourceLabel(key: string): string | undefined {
  return getHostsSource(key)?.label;
}

/** Every URL to try for a source, primary first. */
export function hostsSourceUrls(key: string): readonly string[] {
  const source = getHostsSource(key);
  if (!source) return [];
  return source.mirror === undefined ? [source.url] : [source.url, source.mirror];
}
