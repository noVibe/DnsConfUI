"use client";

import { Download, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { DEFAULT_DNS_DONOR, DNS_DONORS, getDnsDonorLabel } from "@/domain/dns-donors";
import {
  applyOverrides,
  overridableHostnames,
  parseHosts,
  summarizeHosts,
  type HostsSummary,
  type ParsedHostsFile
} from "@/domain/hosts";
import {
  DEFAULT_HOSTS_SOURCE,
  HOSTS_SOURCES,
  getHostsSourceLabel,
  isHostsSourceKey,
  type HostsSourceKey
} from "@/domain/hosts-sources";
import { useLocale } from "@/lib/i18n/context";
import { Button, SecondaryButton, cn, inputClass } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { useDonorChecks } from "@/components/wizard/donor-checks";
import { DonorSelect } from "@/components/wizard/donor-select";

/** The resolve route's own ceiling, so a batch is as large as it is allowed to be. */
const BATCH_SIZE = 50;
/** The route answers 429 beyond 10 concurrent batches; two keeps the walk overlapping without ever going near that. */
const MAX_IN_FLIGHT = 2;
/** More donors than this only lengthen the per-hostname walk the server does on a miss. */
const MAX_DONORS = 4;
const RETRY_BACKOFF_MS = 300;
const MAX_RETRIES = 4;
const RANK_POLL_MS = 25;
/** A donor check that never comes back must not hold a run forever. */
const RANK_TIMEOUT_MS = 12_000;

type Phase = "idle" | "loading" | "ready" | "ranking" | "resolving" | "done";
type BaseKind = "list" | "url" | "file";
type Mode = "auto" | "specific";

type Base = { readonly parsed: ParsedHostsFile; readonly summary: HostsSummary; readonly origin: string };
type Progress = { readonly total: number; readonly done: number; readonly resolved: number; readonly kept: number };
type Resolved = { hostname: string; ip: string | null; ms: number | null; donor: string | null };

const NO_PROGRESS: Progress = { total: 0, done: 0, resolved: 0, kept: 0 };

/**
 * The resolve route's hostname rule, which is stricter than the parser's: it needs at least two labels.
 * A name it would reject is dropped here instead, because one bad name answers the whole batch with 400.
 */
function isResolvableName(value: string): boolean {
  return (
    value.length <= 253 &&
    /^[a-z\d_]([a-z\d_-]{0,61}[a-z\d_])?(\.[a-z\d_]([a-z\d_-]{0,61}[a-z\d_])?)+$/i.test(value)
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) batches.push(items.slice(start, start + size));
  return batches;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // An already aborted signal never fires the event, so it is answered before the timer is armed.
    if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function httpsUrl(value: string): string | null {
  // People paste a bare host, so a missing scheme means HTTPS. The server does the SSRF and size checks.
  const typed = value.trim();
  if (!typed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  try {
    return new URL(candidate).protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

function Radio({
  name,
  checked,
  onSelect,
  children
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink/70">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="size-3.5 accent-moss"
      />
      {children}
    </label>
  );
}

export function HostsBuilder() {
  const { t } = useLocale();
  const headingId = useId();
  const baseGroup = useId();
  const modeGroup = useId();
  const listId = useId();
  const urlId = useId();
  const urlErrorId = useId();
  const fileId = useId();
  const { runChecks, statusOf } = useDonorChecks();

  const [baseKind, setBaseKind] = useState<BaseKind>("list");
  const [sourceKey, setSourceKey] = useState<HostsSourceKey>(DEFAULT_HOSTS_SOURCE);
  const [url, setUrl] = useState("");
  const [urlInvalid, setUrlInvalid] = useState(false);
  const [base, setBase] = useState<Base | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("auto");
  const [donor, setDonor] = useState(DEFAULT_DNS_DONOR);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<Progress>(NO_PROGRESS);
  const [donorCounts, setDonorCounts] = useState<readonly (readonly [string, number])[]>([]);
  const [retried, setRetried] = useState(false);
  const [noDonors, setNoDonors] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // The ranking phase runs inside an async function, so the latest checks are read from a ref rather than a closure.
  const donorStatuses = DNS_DONORS.map((entry) => {
    const status = statusOf(entry.value);
    return { value: entry.value, dns: status.dns, dnsMs: status.dnsMs };
  });
  const statusesRef = useRef(donorStatuses);
  statusesRef.current = donorStatuses;

  const runRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  /** Only one offered file at a time: the previous object URL is released as soon as it is replaced. */
  function offer(text: string | null) {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = text === null ? null : URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    setDownloadUrl(objectUrlRef.current);
  }

  useEffect(
    () => () => {
      runRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  function resetRun() {
    setProgress(NO_PROGRESS);
    setDonorCounts([]);
    setRetried(false);
    setNoDonors(false);
    setCancelled(false);
    offer(null);
  }

  function adopt(text: string, origin: string) {
    const parsed = parseHosts(text);
    setBase({ parsed, summary: summarizeHosts(parsed), origin });
    setError(null);
    setPhase("ready");
  }

  async function loadFromServer() {
    const target = baseKind === "url" ? httpsUrl(url) : null;
    if (baseKind === "url" && target === null) {
      setUrlInvalid(true);
      return;
    }
    setUrlInvalid(false);
    setBase(null);
    setError(null);
    resetRun();
    setPhase("loading");
    try {
      const response = await fetch("/api/hosts/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target === null ? { source: sourceKey } : { url: target })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.text !== "string") {
        setError(t("hosts.loadFailed", { error: body?.error ?? t("common.error") }));
        setPhase("idle");
        return;
      }
      adopt(body.text, typeof body.url === "string" ? body.url : target ?? sourceKey);
    } catch {
      setError(t("hosts.loadFailed", { error: t("common.error") }));
      setPhase("idle");
    }
  }

  async function loadFromDisk(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    resetRun();
    adopt(await file.text(), file.name);
  }

  /**
   * Ranking before resolving, not during: the server walks the donors in the given order for every hostname, so a
   * dead donor in front would cost its DNS timeout on each of a thousand domains.
   */
  async function rankDonors(signal: AbortSignal): Promise<string[]> {
    runChecks();
    const deadline = Date.now() + RANK_TIMEOUT_MS;
    while (statusesRef.current.some((status) => status.dns === "checking") && Date.now() < deadline) {
      await delay(RANK_POLL_MS, signal);
    }
    return statusesRef.current
      .filter((status) => status.dns === "ok")
      .sort((a, b) => (a.dnsMs ?? 0) - (b.dnsMs ?? 0))
      .slice(0, MAX_DONORS)
      .map((status) => status.value);
  }

  async function resolveBatch(hostnames: string[], donors: string[], signal: AbortSignal): Promise<Resolved[]> {
    const missed = (): Resolved[] => hostnames.map((hostname) => ({ hostname, ip: null, ms: null, donor: null }));
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch("/api/hosts/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ donors, hostnames }),
          signal
        });
      } catch (reason) {
        if (signal.aborted) throw reason;
        return missed();
      }
      if (response.ok) {
        const body = await response.json().catch(() => null);
        return Array.isArray(body?.results) ? (body.results as Resolved[]) : missed();
      }
      // 429 means the route is busy, not that the batch is wrong, so it is worth waiting for rather than losing.
      if (response.status !== 429 || attempt >= MAX_RETRIES) return missed();
      setRetried(true);
      await delay(RETRY_BACKOFF_MS * 2 ** attempt, signal);
    }
  }

  async function start() {
    if (!base) return;
    const controller = new AbortController();
    runRef.current = controller;
    resetRun();

    const names = overridableHostnames(base.parsed);
    const resolvable = names.filter(isResolvableName);
    // A name the route would refuse is counted as kept straight away, so the totals stay honest.
    const unusable = names.length - resolvable.length;
    setProgress({ total: names.length, done: unusable, resolved: 0, kept: unusable });

    let donors = [donor];
    if (mode === "auto") {
      setPhase("ranking");
      try {
        donors = await rankDonors(controller.signal);
      } catch {
        setCancelled(true);
        setPhase("ready");
        return;
      }
      if (donors.length === 0) {
        setNoDonors(true);
        setPhase("ready");
        return;
      }
    }

    setPhase("resolving");
    const batches = chunk(resolvable, BATCH_SIZE);
    const overrides = new Map<string, string>();
    const answered = new Map<string, number>();
    let next = 0;

    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const results = await resolveBatch(batch, donors, controller.signal);
        let resolved = 0;
        for (const row of results) {
          if (typeof row?.ip !== "string" || typeof row?.hostname !== "string") continue;
          overrides.set(row.hostname, row.ip);
          resolved += 1;
          if (row.donor) answered.set(row.donor, (answered.get(row.donor) ?? 0) + 1);
        }
        setProgress((current) => ({
          total: current.total,
          done: current.done + batch.length,
          resolved: current.resolved + resolved,
          kept: current.kept + batch.length - resolved
        }));
        setDonorCounts([...answered]);
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, batches.length) }, worker));
    } catch {
      setCancelled(true);
      setPhase("ready");
      return;
    }

    offer(applyOverrides(base.parsed, overrides));
    setPhase("done");
  }

  function cancel() {
    runRef.current?.abort();
  }

  const running = phase === "loading" || phase === "ranking" || phase === "resolving";
  const status =
    phase === "loading"
      ? t("hosts.loading")
      : phase === "ranking"
        ? t("hosts.phase.ranking")
        : phase === "resolving"
          ? t("hosts.phase.resolving")
          : phase === "done"
            ? t("hosts.done", { resolved: progress.resolved, total: progress.total, kept: progress.kept })
            : noDonors
              ? t("hosts.phase.noDonors")
              : cancelled
                ? t("hosts.phase.cancelled")
                : "";
  const progressText = t("hosts.progress.text", {
    done: progress.done,
    total: progress.total,
    resolved: progress.resolved,
    kept: progress.kept
  });

  return (
    <section
      aria-labelledby={headingId}
      className="w-full rounded-lg border border-line bg-white p-4 shadow-soft md:p-6"
    >
      <div className="flex items-center gap-1.5">
        <h2 id={headingId} className="text-base font-semibold text-ink">
          {t("hosts.title")}
        </h2>
        <Tooltip text={t("hosts.tooltip")} />
      </div>
      <p className="mt-2 text-sm leading-6 text-ink/72">{t("hosts.intro")}</p>
      <p className="mt-2 text-xs leading-5 text-ink/50">{t("hosts.note")}</p>

      <fieldset className="mt-4 border-t border-line pt-3">
        <legend className="text-xs font-medium text-ink/70">{t("hosts.base.legend")}</legend>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Radio name={baseGroup} checked={baseKind === "list"} onSelect={() => setBaseKind("list")}>
            {t("hosts.base.list")}
          </Radio>
          <Radio name={baseGroup} checked={baseKind === "url"} onSelect={() => setBaseKind("url")}>
            {t("hosts.base.url")}
          </Radio>
          <Radio name={baseGroup} checked={baseKind === "file"} onSelect={() => setBaseKind("file")}>
            {t("hosts.base.file")}
          </Radio>
        </div>

        {baseKind === "list" ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label htmlFor={listId} className="sr-only">
              {t("hosts.base.listLabel")}
            </label>
            <select
              id={listId}
              value={sourceKey}
              onChange={(event) => {
                if (isHostsSourceKey(event.target.value)) setSourceKey(event.target.value);
              }}
              className={cn(inputClass, "h-8 min-h-0 w-48 py-0 text-xs")}
            >
              {HOSTS_SOURCES.map((source) => (
                <option key={source.key} value={source.key}>
                  {source.label}
                </option>
              ))}
            </select>
            <SecondaryButton type="button" onClick={loadFromServer} disabled={running} className="min-h-8 px-3 py-1 text-xs">
              {t("hosts.load")}
            </SecondaryButton>
          </div>
        ) : null}

        {baseKind === "url" ? (
          <div className="mt-3">
            <label htmlFor={urlId} className="text-xs font-medium text-ink/70">
              {t("hosts.base.urlLabel")}
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id={urlId}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setUrlInvalid(false);
                }}
                placeholder="https://example.com/hosts"
                aria-invalid={urlInvalid}
                aria-describedby={urlInvalid ? urlErrorId : undefined}
                className={cn(inputClass, "h-8 min-h-0 flex-1 py-0 text-xs", urlInvalid && "border-coral")}
              />
              <SecondaryButton type="button" onClick={loadFromServer} disabled={running} className="min-h-8 px-3 py-1 text-xs">
                {t("hosts.load")}
              </SecondaryButton>
            </div>
            {urlInvalid ? (
              <p id={urlErrorId} className="mt-1.5 text-xs text-coral">
                {t("hosts.base.urlInvalid")}
              </p>
            ) : null}
          </div>
        ) : null}

        {baseKind === "file" ? (
          <div className="mt-3">
            <label htmlFor={fileId} className="text-xs font-medium text-ink/70">
              {t("hosts.base.fileLabel")}
            </label>
            <input
              id={fileId}
              type="file"
              onChange={loadFromDisk}
              className="mt-1.5 block w-full text-xs text-ink/70 file:mr-2 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1 file:text-xs file:font-semibold file:text-ink"
            />
          </div>
        ) : null}
      </fieldset>

      {error ? <p className="mt-3 text-sm text-coral">{error}</p> : null}

      {base ? (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="text-xs font-medium text-ink/70">{t("hosts.summary.title", { origin: base.origin })}</h3>
          <ul className="mt-1.5 grid gap-0.5 text-xs text-ink/60">
            <li>{t("hosts.summary.entries", { entries: base.summary.entries, lines: base.summary.lines })}</li>
            <li>{t("hosts.summary.toResolve", { count: base.summary.overridableHostnames })}</li>
            <li>{t("hosts.summary.blocking", { count: base.summary.blockingEntries })}</li>
            {base.summary.ipv6Entries + base.summary.invalidEntries > 0 ? (
              <li>{t("hosts.summary.skipped", { count: base.summary.ipv6Entries + base.summary.invalidEntries })}</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <fieldset className="mt-4 border-t border-line pt-3">
        <legend className="text-xs font-medium text-ink/70">{t("hosts.mode.legend")}</legend>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1">
            <Radio name={modeGroup} checked={mode === "auto"} onSelect={() => setMode("auto")}>
              {t("hosts.mode.auto")}
            </Radio>
            <Tooltip text={t("hosts.mode.autoHint")} className="size-3" />
          </span>
          <Radio name={modeGroup} checked={mode === "specific"} onSelect={() => setMode("specific")}>
            {t("hosts.mode.specific")}
          </Radio>
          {mode === "specific" ? <DonorSelect value={donor} onChange={setDonor} label={t("profiles.donor")} /> : null}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button type="button" onClick={start} disabled={!base || running} className="min-h-9 px-3 py-1.5 text-xs">
          {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          {t("hosts.start")}
        </Button>
        {phase === "ranking" || phase === "resolving" ? (
          <SecondaryButton type="button" onClick={cancel} className="min-h-9 px-3 py-1.5 text-xs">
            {t("common.cancel")}
          </SecondaryButton>
        ) : null}
        {downloadUrl ? (
          <a
            href={downloadUrl}
            download="hosts"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-moss px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-steel"
          >
            <Download className="size-3.5" aria-hidden="true" />
            {t("hosts.download")}
          </a>
        ) : null}
      </div>

      <p role="status" className="mt-3 text-xs text-ink/70">
        {status}
      </p>
      {retried && phase === "resolving" ? <p className="mt-1 text-xs text-ink/50">{t("hosts.phase.retrying")}</p> : null}

      {progress.total > 0 ? (
        <div className="mt-2">
          <div
            role="progressbar"
            aria-label={t("hosts.progress.label")}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-valuetext={progressText}
            className="h-1.5 w-full overflow-hidden rounded-full bg-mint"
          >
            <div
              className="h-full rounded-full bg-moss transition-[width]"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-ink/50">{progressText}</p>
        </div>
      ) : null}

      {donorCounts.length > 0 ? (
        <table className="mt-3 w-full text-xs">
          <caption className="pb-1.5 text-left text-xs font-medium text-ink/70">{t("hosts.donors.title")}</caption>
          <thead>
            <tr className="text-[11px] text-ink/50">
              <th scope="col" className="w-full pb-1 text-left font-normal">
                {t("hosts.donors.server")}
              </th>
              <th scope="col" className="whitespace-nowrap pb-1 text-right font-normal">
                {t("hosts.donors.domains")}
              </th>
            </tr>
          </thead>
          <tbody>
            {donorCounts.map(([value, count]) => (
              <tr key={value} className="border-t border-line">
                <th scope="row" className="py-1 text-left font-normal text-ink">
                  {getDnsDonorLabel(value) ?? value}
                </th>
                <td className="py-1 text-right tabular-nums text-ink/70">{count}</td>
              </tr>
            ))}
            <tr className="border-t border-line">
              <th scope="row" className="py-1 text-left font-normal text-ink/60">
                {t("hosts.donors.kept")}
              </th>
              <td className="py-1 text-right tabular-nums text-ink/70">{progress.kept}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
