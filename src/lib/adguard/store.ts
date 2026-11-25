import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ADGUARD_SOURCES,
  DEFAULT_ADGUARD_SOURCES,
  MAX_ADGUARD_IPS,
  type AdGuardFilterOptions,
  type AdGuardSourceId
} from "@/domain/adguard-sources";
import { DNS_DONORS, getDnsDonorBySlug, type DnsDonor } from "@/domain/dns-donors";
import { resolveBatchA, type ResolveBatchResult } from "@/lib/dns/doh";
import { compileAdGuardFilter, type CompiledAdGuardFilter } from "./compiler";
import {
  chooseStickyIps,
  normalizeDomain,
  parseHostsOverrides,
  type HostsOverrideEntry
} from "./hosts-parser";

const DEFAULT_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_ERROR_RETRY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes (matches Retry-After: 300)
const SOURCE_FETCH_TIMEOUT_MS = 10_000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_COMPILE_CACHE_ENTRIES = 128;
const SNAPSHOT_FILE = "snapshot.json";

export type SourceSnapshot = {
  id: AdGuardSourceId;
  url: string;
  etag: string | null;
  updatedAt: string;
  entries: HostsOverrideEntry[];
};

export type DonorHealthMeta = {
  dnsMs: number | null;
  chatgptMs: number | null;
  country: string | null;
  direct: boolean;
  checkedAt: string;
};

export type DonorSnapshot = {
  slug: string;
  /** Timestamp when `records` last changed (keeps Last-Modified and ETag stable when IPs stay unchanged). */
  updatedAt: string;
  /** Timestamp of the last completed refresh (used for freshness TTL so unchanged IPs do not re-trigger SWR). */
  checkedAt: string;
  /** Timestamp of the most recent failed refresh attempt (used for negative-cache backoff). */
  lastFailedAt?: string;
  /** Source IDs loaded when this donor snapshot was resolved (detects when a previously failed source recovers). */
  resolvedSourceIds?: AdGuardSourceId[];
  status: "ok" | "degraded" | "error";
  resolvedCount: number;
  failedCount: number;
  records: Record<string, string[]>;
  /** Reserved for the upcoming `/adguard/default` smart-routing mode. */
  health?: DonorHealthMeta;
};

export type AdGuardSnapshot = {
  version: 1;
  sources: Partial<Record<AdGuardSourceId, SourceSnapshot>>;
  donors: Record<string, DonorSnapshot>;
};

export type DonorStatusSummary = {
  slug: string;
  label: string;
  status: "ok" | "degraded" | "error" | "warming";
  updatedAt: string | null;
  domainsCount: number;
  rulesCount: number;
};

export type AdGuardStoreDeps = {
  cacheDir?: string;
  refreshIntervalMs?: number;
  errorRetryCooldownMs?: number;
  fetchText?: (url: string, etag: string | null) => Promise<{ status: number; text: string; etag: string | null }>;
  resolveBatch?: (dohUrl: string, domains: readonly string[]) => Promise<ResolveBatchResult>;
  now?: () => Date;
};

async function readResponseTextWithLimit(response: Response, url: string, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Source ${url} exceeds ${maxBytes} bytes.`);
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Source ${url} exceeds ${maxBytes} bytes.`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Source ${url} exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function defaultFetchText(
  url: string,
  etag: string | null
): Promise<{ status: number; text: string; etag: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "User-Agent": "DnsConfUI-AdGuard/1.0" };
    if (etag) headers["If-None-Match"] = etag;
    const response = await fetch(url, { headers, signal: controller.signal });
    if (response.status === 304) {
      return { status: 304, text: "", etag: response.headers.get("etag") ?? etag };
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    const text = await readResponseTextWithLimit(response, url, MAX_SOURCE_BYTES);
    return { status: response.status, text, etag: response.headers.get("etag") };
  } finally {
    clearTimeout(timer);
  }
}

function defaultCacheDir(): string {
  return process.env.ADGUARD_CACHE_DIR?.trim() || path.join(os.tmpdir(), "dnsconf-adguard-cache");
}

function defaultRefreshIntervalMs(): number {
  const parsed = Number(process.env.ADGUARD_REFRESH_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : DEFAULT_REFRESH_INTERVAL_MS;
}

function emptySnapshot(): AdGuardSnapshot {
  return { version: 1, sources: {}, donors: {} };
}

function recordsEqual(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const arrA = a[key];
    const arrB = b[key];
    if (!arrB || arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (arrA[i] !== arrB[i]) return false;
    }
  }
  return true;
}

function buildCompileCacheKey(
  donorSlug: string,
  origin: string,
  options: AdGuardFilterOptions
): string {
  return JSON.stringify([donorSlug, origin, options.sources, options.exclude, options.mode, options.compress, options.maxIps]);
}

export class AdGuardStore {
  private snapshot: AdGuardSnapshot = emptySnapshot();
  private loadPromise: Promise<void> | null = null;
  private sourcesInFlight: Promise<void> | null = null;
  private donorInFlight = new Map<string, Promise<DonorSnapshot | null>>();
  private refreshAllInFlight: Promise<void> | null = null;
  private persistPromise: Promise<void> | null = null;
  private persistPending = false;
  private backgroundRunning = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private statusCache: DonorStatusSummary[] | null = null;
  private compileCache = new Map<string, CompiledAdGuardFilter>();
  private sourceLastFailedAt: Partial<Record<AdGuardSourceId, string>> = {};

  private readonly cacheDir: string;
  private readonly refreshIntervalMs: number;
  private readonly errorRetryCooldownMs: number;
  private readonly fetchText: NonNullable<AdGuardStoreDeps["fetchText"]>;
  private readonly resolveBatch: NonNullable<AdGuardStoreDeps["resolveBatch"]>;
  private readonly now: NonNullable<AdGuardStoreDeps["now"]>;

  constructor(deps: AdGuardStoreDeps = {}) {
    this.cacheDir = deps.cacheDir ?? defaultCacheDir();
    this.refreshIntervalMs = deps.refreshIntervalMs ?? defaultRefreshIntervalMs();
    this.errorRetryCooldownMs = deps.errorRetryCooldownMs ?? DEFAULT_ERROR_RETRY_COOLDOWN_MS;
    this.fetchText = deps.fetchText ?? defaultFetchText;
    this.resolveBatch = deps.resolveBatch ?? ((url, domains) => resolveBatchA(url, domains, { concurrency: 16, timeoutMs: 5000 }));
    this.now = deps.now ?? (() => new Date());
  }

  private get snapshotPath(): string {
    return path.join(this.cacheDir, SNAPSHOT_FILE);
  }

  private invalidateCaches(): void {
    this.statusCache = null;
    this.compileCache.clear();
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.snapshotPath, "utf8");
      const parsed = JSON.parse(raw) as AdGuardSnapshot;
      if (parsed && parsed.version === 1 && parsed.sources && parsed.donors) {
        for (const donor of Object.values(parsed.donors)) {
          if (donor && !donor.checkedAt) {
            donor.checkedAt = donor.updatedAt;
          }
        }
        this.snapshot = parsed;
        this.invalidateCaches();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        console.warn("[adguard-store] Failed to load cache snapshot:", error);
      }
    }
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk();
    }
    return this.loadPromise;
  }

  private persist(): Promise<void> {
    this.persistPending = true;
    if (!this.persistPromise) {
      this.persistPromise = (async () => {
        while (this.persistPending) {
          this.persistPending = false;
          let tmp: string | null = null;
          try {
            await fs.mkdir(this.cacheDir, { recursive: true });
            tmp = `${this.snapshotPath}.${process.pid}.${randomUUID()}.tmp`;
            await fs.writeFile(tmp, JSON.stringify(this.snapshot), "utf8");
            await fs.rename(tmp, this.snapshotPath);
            tmp = null;
          } catch (error) {
            console.error("[adguard-store] Failed to persist cache snapshot:", error);
            if (tmp) {
              await fs.unlink(tmp).catch(() => {});
            }
          }
        }
      })().finally(() => {
        this.persistPromise = null;
      });
    }
    return this.persistPromise;
  }

  private isWithinWindow(timestamp: string | undefined, windowMs: number): boolean {
    if (!timestamp) return false;
    const age = this.now().getTime() - Date.parse(timestamp);
    return Number.isFinite(age) && age >= 0 && age < windowMs;
  }

  private isFresh(timestamp: string | undefined): boolean {
    return this.isWithinWindow(timestamp, this.refreshIntervalMs);
  }

  private getLoadedSourceIds(): AdGuardSourceId[] {
    return ADGUARD_SOURCES.map((s) => s.id).filter((id) => Boolean(this.snapshot.sources[id]));
  }

  private coversLoadedSources(donorSnap: DonorSnapshot): boolean {
    if (!donorSnap.resolvedSourceIds) return true;
    return this.getLoadedSourceIds().every((id) => donorSnap.resolvedSourceIds!.includes(id));
  }

  async refreshSources(force = false): Promise<void> {
    await this.ensureLoaded();
    if (
      !force &&
      ADGUARD_SOURCES.every((source) => {
        const existing = this.snapshot.sources[source.id];
        return existing
          ? this.isFresh(existing.updatedAt)
          : this.isWithinWindow(this.sourceLastFailedAt[source.id], this.errorRetryCooldownMs);
      })
    ) {
      return;
    }

    if (!this.sourcesInFlight) {
      this.sourcesInFlight = (async () => {
        let changed = false;
        await Promise.all(
          ADGUARD_SOURCES.map(async (source) => {
            const existing = this.snapshot.sources[source.id];
            if (!force && existing && this.isFresh(existing.updatedAt)) return;
            if (!force && !existing && this.isWithinWindow(this.sourceLastFailedAt[source.id], this.errorRetryCooldownMs)) return;
            try {
              const res = await this.fetchText(source.url, existing?.etag ?? null);
              const timestamp = this.now().toISOString();
              delete this.sourceLastFailedAt[source.id];
              if (res.status === 304 && existing) {
                this.snapshot.sources[source.id] = { ...existing, etag: res.etag, updatedAt: timestamp };
                changed = true;
                return;
              }
              const entries = parseHostsOverrides(res.text);
              if (entries.length > 0) {
                this.snapshot.sources[source.id] = {
                  id: source.id,
                  url: source.url,
                  etag: res.etag,
                  updatedAt: timestamp,
                  entries
                };
                changed = true;
              }
            } catch (error) {
              this.sourceLastFailedAt[source.id] = this.now().toISOString();
              console.warn(`[adguard-store] Failed to fetch hosts source "${source.id}":`, error);
            }
          })
        );
        if (changed) {
          this.invalidateCaches();
          await this.persist();
        }
      })().finally(() => {
        this.sourcesInFlight = null;
      });
    }

    return this.sourcesInFlight;
  }

  /**
   * Collects every unique normalized domain across all loaded hosts sources (both apex and subdomains)
   * so each subdomain is verified against the donor before compiler compression merges matching IPs.
   */
  private collectTargetDomains(): string[] {
    const allNormalized = new Set<string>();
    for (const source of ADGUARD_SOURCES) {
      const snap = this.snapshot.sources[source.id];
      if (!snap) continue;
      for (const entry of snap.entries) {
        const domain = normalizeDomain(entry.domain, { stripWww: false });
        if (domain) allNormalized.add(domain);
      }
    }
    return [...allNormalized].sort((a, b) => a.localeCompare(b));
  }

  async refreshDonor(donor: DnsDonor, force = false): Promise<DonorSnapshot | null> {
    await this.refreshSources(false);

    const existing = this.snapshot.donors[donor.slug];
    if (!force && existing) {
      if (existing.status === "error" || Object.keys(existing.records).length === 0) {
        if (this.isWithinWindow(existing.lastFailedAt ?? existing.checkedAt, this.errorRetryCooldownMs)) {
          return existing;
        }
      } else if (this.isFresh(existing.checkedAt) && this.coversLoadedSources(existing)) {
        return existing;
      }
    }

    let pending = this.donorInFlight.get(donor.slug);
    if (!pending) {
      pending = (async () => {
        const domains = this.collectTargetDomains();
        if (domains.length === 0) {
          return existing ?? null;
        }

        const loadedSourceIds = this.getLoadedSourceIds();
        const prevRecords = existing?.records ?? {};
        let batch: ResolveBatchResult;
        try {
          batch = await this.resolveBatch(donor.value, domains);
        } catch (error) {
          console.warn(`[adguard-store] DoH batch failed for donor "${donor.slug}":`, error);
          batch = { records: new Map(), succeeded: 0, failed: domains.length, aborted: true };
        }

        const nowIso = this.now().toISOString();

        // If the donor is completely unreachable, preserve any previous working snapshot instead of wiping rules,
        // and record `lastFailedAt` so subsequent requests respect the retry cooldown.
        if (batch.succeeded === 0) {
          if (existing && Object.keys(existing.records).length > 0) {
            const preserved: DonorSnapshot = { ...existing, lastFailedAt: nowIso };
            this.snapshot.donors[donor.slug] = preserved;
            return preserved;
          }
          const failedSnap: DonorSnapshot = {
            slug: donor.slug,
            updatedAt: nowIso,
            checkedAt: nowIso,
            lastFailedAt: nowIso,
            resolvedSourceIds: loadedSourceIds,
            status: "error",
            resolvedCount: 0,
            failedCount: batch.failed,
            records: {}
          };
          this.snapshot.donors[donor.slug] = failedSnap;
          this.invalidateCaches();
          return failedSnap;
        }

        const nextRecords: Record<string, string[]> = {};
        for (const domain of domains) {
          if (batch.records.has(domain)) {
            const freshIps = batch.records.get(domain)!;
            const sticky = chooseStickyIps(prevRecords[domain] ?? [], freshIps, MAX_ADGUARD_IPS);
            if (sticky.length > 0) {
              nextRecords[domain] = sticky;
            }
          } else if (prevRecords[domain]?.length) {
            // Transient transport timeout on a single domain: keep previous known IP.
            nextRecords[domain] = prevRecords[domain];
          }
        }

        const unchanged = existing && recordsEqual(existing.records, nextRecords);
        const updated: DonorSnapshot = {
          slug: donor.slug,
          updatedAt: unchanged ? existing.updatedAt : nowIso,
          checkedAt: nowIso,
          resolvedSourceIds: loadedSourceIds,
          status: batch.aborted || batch.failed > domains.length * 0.25 ? "degraded" : "ok",
          resolvedCount: Object.keys(nextRecords).length,
          failedCount: batch.failed,
          records: nextRecords,
          health: existing?.health
        };
        this.snapshot.donors[donor.slug] = updated;
        this.invalidateCaches();
        await this.persist();
        return updated;
      })().finally(() => {
        this.donorInFlight.delete(donor.slug);
      });
      this.donorInFlight.set(donor.slug, pending);
    }

    return pending;
  }

  async refreshAll(force = false): Promise<void> {
    if (!this.refreshAllInFlight) {
      this.refreshAllInFlight = (async () => {
        await this.refreshSources(force);
        // Refresh donors with modest concurrency so outbound DoH traffic stays gentle on the VPS.
        const queue = [...DNS_DONORS];
        const workers = Array.from({ length: 3 }, async () => {
          while (queue.length > 0) {
            const donor = queue.shift();
            if (!donor) return;
            await this.refreshDonor(donor, force);
          }
        });
        await Promise.all(workers);
      })().finally(() => {
        this.refreshAllInFlight = null;
      });
    }
    return this.refreshAllInFlight;
  }

  startBackgroundRefresh(): void {
    if (this.backgroundRunning) return;
    this.backgroundRunning = true;
    const scheduleNext = () => {
      if (!this.backgroundRunning) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.backgroundRunning) return;
        void this.refreshAll(true).finally(scheduleNext);
      }, this.refreshIntervalMs);
      this.timer.unref?.();
    };
    void this.ensureLoaded()
      .then(() => this.refreshAll(false))
      .finally(scheduleNext);
  }

  stopBackgroundRefresh(): void {
    this.backgroundRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private buildEntriesForDonor(
    donorSnapshot: DonorSnapshot,
    sourceIds: readonly AdGuardSourceId[]
  ): HostsOverrideEntry[] {
    const entries: HostsOverrideEntry[] = [];
    const seen = new Set<string>();

    for (const sourceId of sourceIds) {
      const sourceSnap = this.snapshot.sources[sourceId];
      if (!sourceSnap) continue;
      for (const rawEntry of sourceSnap.entries) {
        const domain = normalizeDomain(rawEntry.domain, { stripWww: false });
        if (!domain || seen.has(domain)) continue;
        seen.add(domain);

        const ips = donorSnapshot.records[domain];
        if (ips && ips.length > 0) {
          entries.push({ domain, ips });
        }
      }
    }

    return entries;
  }

  async compileForDonor(
    donorSlug: string,
    options: AdGuardFilterOptions,
    origin: string
  ): Promise<{ ok: true; compiled: CompiledAdGuardFilter; updatedAt: string } | { ok: false; status: number; error: string }> {
    const donor = getDnsDonorBySlug(donorSlug);
    if (!donor) {
      return { ok: false, status: 404, error: `Unknown DNS donor "${donorSlug}".` };
    }

    await this.ensureLoaded();
    let donorSnap: DonorSnapshot | null = this.snapshot.donors[donor.slug] ?? null;
    const hasAnyRequestedSource = options.sources.some((id) => Boolean(this.snapshot.sources[id]));
    const needsFreshDonor = donorSnap ? !this.isFresh(donorSnap.checkedAt) || !this.coversLoadedSources(donorSnap) : true;
    const hasRetryableMissingSource = options.sources.some(
      (id) => !this.snapshot.sources[id] && !this.isWithinWindow(this.sourceLastFailedAt[id], this.errorRetryCooldownMs)
    );

    if (!donorSnap || !hasAnyRequestedSource || Object.keys(donorSnap.records).length === 0) {
      donorSnap = await this.refreshDonor(donor, false);
    } else if (
      (needsFreshDonor || hasRetryableMissingSource) &&
      !this.isWithinWindow(donorSnap.lastFailedAt, this.errorRetryCooldownMs)
    ) {
      // Stale-while-revalidate: serve immediately from cache and refresh in background.
      void this.refreshDonor(donor, needsFreshDonor);
    }

    if (!donorSnap || Object.keys(donorSnap.records).length === 0) {
      return {
        ok: false,
        status: 503,
        error: `DNS donor "${donor.label}" is currently unreachable. Please try again later.`
      };
    }

    const cacheKey = buildCompileCacheKey(donor.slug, origin, options);
    const cached = this.compileCache.get(cacheKey);
    if (cached) {
      return { ok: true, compiled: cached, updatedAt: donorSnap.updatedAt };
    }

    const entries = this.buildEntriesForDonor(donorSnap, options.sources);
    if (entries.length === 0) {
      return {
        ok: false,
        status: 503,
        error: `No proxy rules available for donor "${donor.label}" right now.`
      };
    }

    const sourceNames = options.sources
      .map((id) => ADGUARD_SOURCES.find((s) => s.id === id)?.label ?? id)
      .join(" + ");

    const compiled = compileAdGuardFilter({
      title: `DnsConf AdGuard — ${donor.label}`,
      description: `Dynamic $dnsrewrite proxy routing via ${donor.label} (${sourceNames})`,
      homepage: `${origin}/adguard`,
      updatedAt: donorSnap.updatedAt,
      entries,
      options
    });

    if (this.compileCache.size >= MAX_COMPILE_CACHE_ENTRIES) {
      const oldestKey = this.compileCache.keys().next().value;
      if (oldestKey !== undefined) this.compileCache.delete(oldestKey);
    }
    this.compileCache.set(cacheKey, compiled);

    return { ok: true, compiled, updatedAt: donorSnap.updatedAt };
  }

  async getStatusSummaries(): Promise<DonorStatusSummary[]> {
    await this.ensureLoaded();
    if (this.statusCache) return this.statusCache;

    const defaultOptions: AdGuardFilterOptions = {
      sources: [...DEFAULT_ADGUARD_SOURCES],
      exclude: [],
      mode: "sub",
      compress: true,
      maxIps: MAX_ADGUARD_IPS
    };

    const summaries: DonorStatusSummary[] = DNS_DONORS.map((donor) => {
      const snap = this.snapshot.donors[donor.slug];
      if (!snap) {
        return {
          slug: donor.slug,
          label: donor.label,
          status: "warming",
          updatedAt: null,
          domainsCount: 0,
          rulesCount: 0
        };
      }
      if (snap.status === "error" || Object.keys(snap.records).length === 0) {
        return {
          slug: donor.slug,
          label: donor.label,
          status: "error",
          updatedAt: snap.updatedAt,
          domainsCount: 0,
          rulesCount: 0
        };
      }
      const entries = this.buildEntriesForDonor(snap, defaultOptions.sources);
      const compiled = compileAdGuardFilter({
        title: donor.label,
        description: "",
        homepage: "",
        updatedAt: snap.updatedAt,
        entries,
        options: defaultOptions
      });
      return {
        slug: donor.slug,
        label: donor.label,
        status: snap.status,
        updatedAt: snap.updatedAt,
        domainsCount: compiled.compressedDomainsCount,
        rulesCount: compiled.rulesCount
      };
    });

    this.statusCache = summaries;
    return summaries;
  }
}

const GLOBAL_STORE_KEY = "__dnsconfAdGuardStore__";

export function getAdGuardStore(): AdGuardStore {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_STORE_KEY]) {
    g[GLOBAL_STORE_KEY] = new AdGuardStore();
  }
  return g[GLOBAL_STORE_KEY] as AdGuardStore;
}
