import { GEOHIDE_HOSTS_LIST, MALW_HOSTS_LIST } from "./toggles";

export const ADGUARD_SOURCES = [
  { id: "geohide", label: "GeoHide", url: GEOHIDE_HOSTS_LIST },
  { id: "malw", label: "Malw", url: MALW_HOSTS_LIST }
] as const;

export type AdGuardSourceId = (typeof ADGUARD_SOURCES)[number]["id"];
export type AdGuardMatchMode = "sub" | "exact";

export const DEFAULT_ADGUARD_SOURCES: readonly AdGuardSourceId[] = ["geohide", "malw"];
export const DEFAULT_ADGUARD_MATCH_MODE: AdGuardMatchMode = "sub";
export const DEFAULT_ADGUARD_COMPRESS = true;
export const DEFAULT_ADGUARD_MAX_IPS = 4;
export const MAX_ADGUARD_IPS = 4;
export const MAX_ADGUARD_EXCLUDES = 50;

const VALID_SOURCE_IDS = new Set<string>(ADGUARD_SOURCES.map((source) => source.id));
const LOCALHOST_NAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback", "localdomain"]);
const EXCLUDE_LABEL_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}_-]{0,61}[\p{L}\p{N}])?$/u;

export type AdGuardFilterOptions = {
  sources: AdGuardSourceId[];
  exclude: string[];
  mode: AdGuardMatchMode;
  compress: boolean;
  maxIps: number;
};

export type ParsedAdGuardQuery =
  | { ok: true; options: AdGuardFilterOptions }
  | { ok: false; error: string };

/**
 * Browser-safe validation matching compiler hostname rules (rejects empty labels, leading/trailing hyphens,
 * IP literals, localhost, wildcards and URLs). Full Punycode normalization also runs on the server.
 */
export function isValidExcludeDomain(raw: string): boolean {
  const domain = raw.trim().toLowerCase().replace(/\.+$/, "");
  if (
    !domain ||
    domain.length > 253 ||
    domain.includes("://") ||
    domain.includes("/") ||
    domain.includes("*") ||
    !domain.includes(".") ||
    LOCALHOST_NAMES.has(domain)
  ) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.some((label) => label.length === 0 || label.length > 63 || !EXCLUDE_LABEL_PATTERN.test(label))) {
    return false;
  }
  // Reject IPv4 literals (all-numeric TLD is invalid in DNS).
  if (/^\d+$/.test(labels[labels.length - 1])) {
    return false;
  }
  return true;
}

/**
 * Extracts a normalized hostname from a raw user token (accepts bare domains as well as pasted URLs
 * like `https://instagram.com/reels` or `instagram.com/path`).
 */
export function extractCandidateDomain(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.hostname.toLowerCase().replace(/\.+$/, "");
      }
      return trimmed.toLowerCase();
    } catch {
      return trimmed.toLowerCase();
    }
  }

  if (trimmed.includes("/") || trimmed.includes(":") || trimmed.includes("?") || trimmed.includes("#")) {
    try {
      const parsed = new URL(`https://${trimmed}`);
      return parsed.hostname.toLowerCase().replace(/\.+$/, "");
    } catch {
      return trimmed.toLowerCase();
    }
  }

  return trimmed.toLowerCase().replace(/\.+$/, "");
}

export type ParsedExcludeInput = {
  valid: string[];
  invalid: string[];
  overflowCount: number;
};

/**
 * Parses free-form textarea input for excluded domains: splits on whitespace/commas/semicolons
 * (preserving URL slashes so hostnames can be extracted), validates, deduplicates and enforces MAX_ADGUARD_EXCLUDES.
 */
export function parseExcludeInput(value: string): ParsedExcludeInput {
  const tokens = value
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let overflowCount = 0;

  for (const token of tokens) {
    const candidate = extractCandidateDomain(token);
    if (!isValidExcludeDomain(candidate)) {
      invalid.push(token);
      continue;
    }
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (valid.length < MAX_ADGUARD_EXCLUDES) {
      valid.push(candidate);
    } else {
      overflowCount++;
    }
  }

  return { valid, invalid, overflowCount };
}

export function parseAdGuardQueryParams(searchParams: URLSearchParams): ParsedAdGuardQuery {
  const rawSources = searchParams.get("sources");
  let sources: AdGuardSourceId[];
  if (rawSources === null || rawSources.trim() === "") {
    sources = [...DEFAULT_ADGUARD_SOURCES];
  } else {
    const parsed: AdGuardSourceId[] = [];
    for (const item of rawSources.split(",")) {
      const id = item.trim().toLowerCase();
      if (!id) continue;
      if (!VALID_SOURCE_IDS.has(id)) {
        return { ok: false, error: `Unknown source "${id}". Allowed: ${ADGUARD_SOURCES.map((s) => s.id).join(", ")}.` };
      }
      if (!parsed.includes(id as AdGuardSourceId)) {
        parsed.push(id as AdGuardSourceId);
      }
    }
    if (parsed.length === 0) {
      return { ok: false, error: "Select at least one source." };
    }
    sources = parsed;
  }

  const rawMode = searchParams.get("mode")?.trim().toLowerCase();
  let mode: AdGuardMatchMode = DEFAULT_ADGUARD_MATCH_MODE;
  if (rawMode !== undefined && rawMode !== "") {
    if (rawMode !== "sub" && rawMode !== "exact") {
      return { ok: false, error: 'Invalid mode. Allowed values: "sub", "exact".' };
    }
    mode = rawMode;
  }

  const rawCompress = searchParams.get("compress")?.trim().toLowerCase();
  let compress = DEFAULT_ADGUARD_COMPRESS;
  if (rawCompress !== undefined && rawCompress !== "") {
    if (rawCompress === "1" || rawCompress === "true") {
      compress = true;
    } else if (rawCompress === "0" || rawCompress === "false") {
      compress = false;
    } else {
      return { ok: false, error: 'Invalid compress flag. Allowed values: "1", "0", "true", "false".' };
    }
  }

  const rawIps = searchParams.get("ips")?.trim();
  let maxIps = DEFAULT_ADGUARD_MAX_IPS;
  if (rawIps !== undefined && rawIps !== "") {
    if (!/^\d+$/.test(rawIps)) {
      return { ok: false, error: `Invalid ips limit. Use an integer between 1 and ${MAX_ADGUARD_IPS}.` };
    }
    const parsedIps = Number(rawIps);
    if (parsedIps < 1 || parsedIps > MAX_ADGUARD_IPS) {
      return { ok: false, error: `Invalid ips limit. Use an integer between 1 and ${MAX_ADGUARD_IPS}.` };
    }
    maxIps = parsedIps;
  }

  const rawExclude = searchParams.get("exclude");
  const exclude: string[] = [];
  if (rawExclude !== null && rawExclude.trim() !== "") {
    const seen = new Set<string>();
    for (const part of rawExclude.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const domain = trimmed.toLowerCase().replace(/\.+$/, "");
      if (!isValidExcludeDomain(domain)) {
        return { ok: false, error: `Invalid excluded domain "${trimmed}".` };
      }
      if (!seen.has(domain)) {
        seen.add(domain);
        exclude.push(domain);
      }
      if (exclude.length > MAX_ADGUARD_EXCLUDES) {
        return { ok: false, error: `Too many excluded domains (max ${MAX_ADGUARD_EXCLUDES}).` };
      }
    }
  }

  return { ok: true, options: { sources, exclude, mode, compress, maxIps } };
}

export function buildAdGuardListPath(slug: string, options: Partial<AdGuardFilterOptions> = {}): string {
  const params = new URLSearchParams();
  const sources = options.sources ?? DEFAULT_ADGUARD_SOURCES;
  const isDefaultSources =
    sources.length === DEFAULT_ADGUARD_SOURCES.length &&
    sources.every((id, index) => id === DEFAULT_ADGUARD_SOURCES[index]);
  if (!isDefaultSources && sources.length > 0) {
    params.set("sources", sources.join(","));
  }

  const exclude = (options.exclude ?? []).map((d) => d.trim().toLowerCase().replace(/\.+$/, "")).filter(Boolean);
  if (exclude.length > 0) {
    params.set("exclude", exclude.join(","));
  }

  const mode = options.mode ?? DEFAULT_ADGUARD_MATCH_MODE;
  if (mode !== DEFAULT_ADGUARD_MATCH_MODE) {
    params.set("mode", mode);
  }

  const compress = options.compress ?? DEFAULT_ADGUARD_COMPRESS;
  if (mode === "sub" && compress !== DEFAULT_ADGUARD_COMPRESS) {
    params.set("compress", compress ? "1" : "0");
  }

  const maxIps = options.maxIps ?? DEFAULT_ADGUARD_MAX_IPS;
  if (maxIps !== DEFAULT_ADGUARD_MAX_IPS) {
    params.set("ips", String(maxIps));
  }

  const query = params.toString();
  return query ? `/adguard/${slug}?${query}` : `/adguard/${slug}`;
}
