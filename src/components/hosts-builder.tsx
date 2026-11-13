"use client";

import { Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { DEFAULT_DNS_DONOR, getDnsDonorLabel } from "@/domain/dns-donors";
import {
  applyOverrides,
  overridableHostnames,
  parseHosts,
  summarizeHosts,
  type HostsEntryClass,
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
/**
 * How many batches the sweep keeps in flight.
 *
 * The sweep is not paced by the same thing as the main pass. It asks each leftover hostname only the donors the
 * narrowed pair did not use, and those are by construction the donors that ranked last for failing to answer — so
 * nearly all of its wall time is spent waiting out the 5s DNS timeout rather than doing work. A measured run had
 * the main pass cover 1040 domains in 158s and the sweep spend 164s on the 213 left over. Waiting on more of those
 * timeouts at the same time is the only thing that shortens them, and it buys no extra work for the resolver to do.
 * Five still leaves half of the route's ten-batch ceiling free for the ping table's own checks.
 */
const SWEEP_IN_FLIGHT = 5;
/** More donors than this only lengthen the per-hostname walk the server does on a miss. */
const MAX_DONORS = 4;
/**
 * How many domains go out under the full ranked donor list before the run narrows to the leaders.
 *
 * Nothing about coverage is known until batches come back, and a wrong guess is expensive: a measured GeoHide run
 * had one donor cover 812 of 1040 domains and another cover 8, so the tally needs real answers under it before it
 * can be trusted to pick two. A hundred domains is two batches — exactly the two that are already in flight before
 * the first answer arrives — so discovery costs the run no round trip it was not making anyway.
 */
const DISCOVERY_DOMAINS = 100;
const DISCOVERY_BATCHES = Math.ceil(DISCOVERY_DOMAINS / BATCH_SIZE);
/**
 * How many donors a batch carries once discovery is over.
 *
 * Measured against the live app, the same 50 domains came back identically resolved (41 of 50) whether one donor or
 * four were sent — 6.7s against 27s. The cost is the number of attempts a hostname pays, not their order, and the
 * three donors behind the leader added no coverage at all for that sample. Two keeps a second opinion for the
 * domains the leader misses; whatever neither of them covers is finished off by the sweep, so nothing is lost.
 */
const NARROWED_DONORS = 2;
const RETRY_BACKOFF_MS = 300;
const MAX_RETRIES = 4;

type Phase = "idle" | "loading" | "ready" | "ranking" | "resolving" | "sweeping" | "done";
type BaseKind = "list" | "url" | "file";
type Mode = "auto" | "specific";

type Base = { readonly parsed: ParsedHostsFile; readonly summary: HostsSummary; readonly origin: string };
type Progress = { readonly total: number; readonly done: number; readonly resolved: number; readonly kept: number };
type Resolved = { hostname: string; ip: string | null; ms: number | null; donor: string | null };

/** One request's worth of work for the run loop. */
type Job = {
  readonly hostnames: string[];
  /** The donors to send when the phase fixed them up front; `null` lets the dispatch pick from the live tally. */
  readonly donors: readonly string[] | null;
  /** Whether these hostnames are new work: a sweep re-asks hostnames the main pass has already counted as done. */
  readonly fresh: boolean;
};

const NO_PROGRESS: Progress = { total: 0, done: 0, resolved: 0, kept: 0 };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) batches.push(items.slice(start, start + size));
  return batches;
}

/**
 * The donors with the better observed coverage first, which is both who a batch asks first and who it asks at all:
 * the narrowed pass sends the leading `NARROWED_DONORS` of this order and the sweep sends what is left of it.
 *
 * How fast a donor answers for one probe name says almost nothing about how much of a published list it can
 * resolve: a measured GeoHide run had the fastest donor cover 8 domains of 1040 and the third-fastest cover 812, so
 * nearly every domain paid two failed DNS lookups before the one that answers. Once batches come back, how many
 * hostnames a donor actually supplied is known, and that is what the order is built from instead.
 *
 * The rate is smoothed — `(resolved + 1) / (asked + 2)` — which is what makes it behave with few observations. A
 * donor nothing is known about yet scores as even money: behind one that is answering, ahead of one that has been
 * asked and missed, so it is still tried rather than buried, and one early success cannot pin the order for the
 * rest of the run. The sort is stable, so donors on equal terms keep the order they came in with, which is why the
 * first batch goes out in the latency order and nothing else needs a special case.
 */
function byCoverage(
  donors: readonly string[],
  answered: ReadonlyMap<string, number>,
  asked: ReadonlyMap<string, number>
): string[] {
  const rate = (donor: string) => ((answered.get(donor) ?? 0) + 1) / ((asked.get(donor) ?? 0) + 2);
  // Reordered, never shortened: the donor that resolves the fewest domains may be the only one that covers them.
  return [...donors].sort((a, b) => rate(b) - rate(a));
}

/** Never resolves: it rejects as soon as the run is cancelled, so an await can race a step against the cancel. */
function cancellation(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
  });
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

/**
 * Whether a group of entries the run only copies through is carried into the result at all.
 *
 * The visible wording is the same on every group, so each checkbox is given its own accessible name: a screen
 * reader moving between the form controls would otherwise meet two boxes both called "include in the file".
 */
function Include({
  label,
  text,
  checked,
  onChange
}: {
  label: string;
  text: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink/50">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-moss"
      />
      {text}
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
  const { runChecks } = useDonorChecks();

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
  /** The run's own answers, kept so a change to what the file should carry can rebuild it without resolving again. */
  const [resolvedIps, setResolvedIps] = useState<ReadonlyMap<string, string> | null>(null);
  const [includeBlocking, setIncludeBlocking] = useState(true);
  const [includeOther, setIncludeOther] = useState(true);

  const runRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  /** Only one offered file at a time: the previous object URL is released as soon as it is replaced. */
  const offer = useCallback((text: string | null) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = text === null ? null : URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    setDownloadUrl(objectUrlRef.current);
  }, []);

  useEffect(
    () => () => {
      runRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  /**
   * Writes the file on offer out of the run's answers and the two inclusion choices.
   *
   * Which entries the result carries is a different question from which addresses are current, so it is answered
   * here instead of at the end of the run: unticking a group afterwards rebuilds the file from the answers already
   * in hand, with nothing asked of DNS again. Doing it in an effect rather than in the checkbox's own handler is
   * what keeps a tick during a run honest, because the run would otherwise write the file with the flags it closed
   * over when it started.
   */
  useEffect(() => {
    if (!base || !resolvedIps) return;
    const omit: HostsEntryClass[] = [];
    if (!includeBlocking) omit.push("blocking");
    if (!includeOther) omit.push("ipv6", "invalid");
    offer(applyOverrides(base.parsed, resolvedIps, { omit }));
  }, [base, resolvedIps, includeBlocking, includeOther, offer]);

  function resetRun() {
    setProgress(NO_PROGRESS);
    setDonorCounts([]);
    setRetried(false);
    setNoDonors(false);
    setCancelled(false);
    setResolvedIps(null);
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
   * The order the run starts from: the server walks the donors in the given order for every hostname, so a dead
   * donor in front would cost its DNS timeout on each of a thousand domains. Latency is all there is to go on
   * before the first results; from then on `byCoverage` reorders by what the donors actually resolved.
   */
  async function rankDonors(signal: AbortSignal): Promise<string[]> {
    // The checks report themselves when they are all in, so there is nothing to poll and no ceiling to truncate a
    // slow network at; cancelling the run still answers at once, because the cancel is raced against them.
    const checked = await Promise.race([runChecks(), cancellation(signal)]);
    return checked
      .filter(({ check }) => check.dnsMs !== null)
      .sort((a, b) => (a.check.dnsMs ?? 0) - (b.check.dnsMs ?? 0))
      .slice(0, MAX_DONORS)
      .map(({ donor }) => donor);
  }

  async function resolveBatch(
    hostnames: string[],
    donors: readonly string[],
    signal: AbortSignal
  ): Promise<Resolved[]> {
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

    // A legal name no resolver can be asked about (`localhost` and friends) keeps its original address, so it is
    // counted as done and kept from the start rather than left out of the totals.
    const names = overridableHostnames(base.parsed);
    const unresolvable = base.summary.unresolvableHostnames;
    setProgress({ total: names.length + unresolvable, done: unresolvable, resolved: 0, kept: unresolvable });

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
    const overrides = new Map<string, string>();
    // The tally is per run and lives here, in the run's own closure, so a new run starts clean with no reset to
    // forget. `answered` is the one count of who supplied an address: the attribution table renders it and the
    // ranking reads it, rather than two counters drifting apart. `asked` is how often a donor was walked at all.
    const answered = new Map<string, number>();
    const asked = new Map<string, number>();
    // Every hostname still without an address, against the donors it has already been walked through. The sweep
    // reads it to ask each one the donors it is still owed, and a hostname leaves it the moment one answers.
    const outstanding = new Map<string, readonly string[]>();

    /**
     * Charges one hostname's attempts. The server walks the donors in the order it was sent and stops at the first
     * one that supplies a working address, so the donor that answered and every donor ahead of it were asked; a
     * row with no address was asked of all of them.
     */
    const charge = (order: readonly string[], answeredBy: string | null) => {
      const found = answeredBy === null ? -1 : order.indexOf(answeredBy);
      const walked = found < 0 ? order.length : found + 1;
      for (const donor of order.slice(0, walked)) asked.set(donor, (asked.get(donor) ?? 0) + 1);
    };

    /**
     * What a main-pass batch asks. Discovery sends the whole ranked list, because nothing is known yet; after that
     * only the leading pair, re-picked here from the tally every time, so a leader that degrades is replaced
     * rather than trusted to the end of the run.
     */
    const donorsForBatch = (index: number) => {
      const ranked = byCoverage(donors, answered, asked);
      return index < DISCOVERY_BATCHES ? ranked : ranked.slice(0, NARROWED_DONORS);
    };

    /** Runs a list of jobs `inFlight` at a time, each with the donors it is due at the moment it goes out. */
    const pump = async (jobs: readonly Job[], inFlight: number) => {
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const index = next++;
          const job = jobs[index];
          // Both the cursor and the donors are read in this one synchronous step, before the next await: whatever
          // the batches that have already answered taught is in the tally by now, so the workers sharing the cursor
          // always dispatch with the current narrowed pair, and a change of pair reaches every later batch.
          const order = job.donors ?? donorsForBatch(index);
          const results = await resolveBatch(job.hostnames, order, controller.signal);
          // Recorded before the rows are read, so a hostname the server left out of its answer is still owed the
          // rest of the walk rather than quietly dropped from the sweep.
          for (const hostname of job.hostnames) {
            const walked = outstanding.get(hostname);
            outstanding.set(hostname, walked ? [...new Set([...walked, ...order])] : [...order]);
          }
          let resolved = 0;
          for (const row of results) {
            if (typeof row?.hostname !== "string") continue;
            if (typeof row.ip === "string") {
              overrides.set(row.hostname, row.ip);
              outstanding.delete(row.hostname);
              resolved += 1;
              if (row.donor) answered.set(row.donor, (answered.get(row.donor) ?? 0) + 1);
            }
            charge(order, typeof row.ip === "string" ? row.donor : null);
          }
          // A sweep re-asks hostnames the main pass already counted, so it moves them from kept to resolved
          // instead of adding to `done`: `resolved + kept` stays equal to `done`, and neither of them ever drops.
          setProgress((current) => ({
            total: current.total,
            done: current.done + (job.fresh ? job.hostnames.length : 0),
            resolved: current.resolved + resolved,
            kept: job.fresh ? current.kept + job.hostnames.length - resolved : current.kept - resolved
          }));
          setDonorCounts([...answered]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(inFlight, jobs.length) }, worker));
    };

    /**
     * The batches that finish the walk the narrowed pass cut short.
     *
     * A hostname with no address was walked through every donor its batch carried, so the donors it has not been
     * asked are exactly the ranked ones missing from its entry in `outstanding`. Asking those, and only those, is
     * what makes narrowing safe: a hostname nobody resolves still ends the run having been put to every ranked
     * donor once — the same total it paid when every batch carried the whole list — and a donor that is the only
     * one covering a handful of domains still gets its turn at them. Hostnames narrowed to different pairs owe
     * different donors, so they are grouped by what they are owed rather than swept under one list.
     */
    const sweepJobs = (): Job[] => {
      const ranked = byCoverage(donors, answered, asked);
      const groups = new Map<string, { donors: readonly string[]; hostnames: string[] }>();
      for (const [hostname, walked] of outstanding) {
        const owed = ranked.filter((candidate) => !walked.includes(candidate));
        if (owed.length === 0) continue;
        const key = owed.join(" ");
        const group = groups.get(key) ?? { donors: owed, hostnames: [] };
        group.hostnames.push(hostname);
        groups.set(key, group);
      }
      return [...groups.values()].flatMap((group) =>
        chunk(group.hostnames, BATCH_SIZE).map((hostnames) => ({ hostnames, donors: group.donors, fresh: false }))
      );
    };

    try {
      const main = chunk(names, BATCH_SIZE).map((hostnames) => ({ hostnames, donors: null, fresh: true }));
      await pump(main, MAX_IN_FLIGHT);
      const sweep = sweepJobs();
      if (sweep.length > 0) {
        setPhase("sweeping");
        await pump(sweep, SWEEP_IN_FLIGHT);
      }
    } catch {
      setCancelled(true);
      setPhase("ready");
      return;
    }

    setResolvedIps(overrides);
    setPhase("done");
  }

  function cancel() {
    runRef.current?.abort();
  }

  /**
   * The three groups the summary shows account for every entry in the file: the redirects a run refreshes, the
   * blocking pins, and what nothing here can refresh. `otherEntries` is the third of them, which is two entry
   * classes rather than one, because the reason they are only copied through is the same from where the user sits.
   */
  const otherEntries = base === null ? 0 : base.summary.ipv6Entries + base.summary.invalidEntries;
  /** A published list or an address of the user's own is a link; a file from their computer is only a name. */
  const sourceHref = base !== null && /^https?:\/\//i.test(base.origin) ? base.origin : null;

  const resolving = phase === "resolving" || phase === "sweeping";
  const running = phase === "loading" || phase === "ranking" || resolving;
  const status =
    phase === "loading"
      ? t("hosts.loading")
      : phase === "ranking"
        ? t("hosts.phase.ranking")
        : phase === "resolving"
          ? t("hosts.phase.resolving")
          : phase === "sweeping"
            ? t("hosts.phase.sweeping")
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
          <h3 className="text-xs font-medium text-ink/70">
            {t("hosts.summary.title")}
            {" ("}
            {sourceHref ? (
              <a
                href={sourceHref}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                {t("hosts.summary.source")}
              </a>
            ) : (
              base.origin
            )}
            {")"}
          </h3>
          <ul className="mt-1.5 grid gap-1 text-xs text-ink/60">
            <li>{t("hosts.summary.entries", { entries: base.summary.entries, lines: base.summary.lines })}</li>
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1">
                {t("hosts.group.redirect", { count: base.summary.overridableEntries })}
                <Tooltip
                  text={t("hosts.group.redirectHint", { domains: base.summary.overridableHostnames })}
                  className="size-3"
                />
              </span>
            </li>
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1">
                {t("hosts.group.blocking", { count: base.summary.blockingEntries })}
                <Tooltip text={t("hosts.group.blockingHint")} className="size-3" />
              </span>
              {base.summary.blockingEntries > 0 ? (
                <Include
                  label={t("hosts.group.includeBlocking")}
                  text={t("hosts.group.include")}
                  checked={includeBlocking}
                  onChange={setIncludeBlocking}
                />
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1">
                {t("hosts.group.other", { count: otherEntries })}
                <Tooltip text={t("hosts.group.otherHint")} className="size-3" />
              </span>
              {otherEntries > 0 ? (
                <Include
                  label={t("hosts.group.includeOther")}
                  text={t("hosts.group.include")}
                  checked={includeOther}
                  onChange={setIncludeOther}
                />
              ) : null}
            </li>
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
        {phase === "ranking" || resolving ? (
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
      {retried && resolving ? <p className="mt-1 text-xs text-ink/50">{t("hosts.phase.retrying")}</p> : null}

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
