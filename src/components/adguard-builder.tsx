"use client";

import { Check, ChevronDown, Copy, ExternalLink, RefreshCw, Shield } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ADGUARD_SOURCES,
  buildAdGuardListPath,
  DEFAULT_ADGUARD_COMPRESS,
  DEFAULT_ADGUARD_MATCH_MODE,
  DEFAULT_ADGUARD_MAX_IPS,
  DEFAULT_ADGUARD_SOURCES,
  MAX_ADGUARD_EXCLUDES,
  MAX_ADGUARD_IPS,
  parseExcludeInput,
  type AdGuardMatchMode,
  type AdGuardSourceId
} from "@/domain/adguard-sources";
import { DEFAULT_DNS_DONOR_SLUG, DNS_DONORS } from "@/domain/dns-donors";
import type { DonorStatusSummary } from "@/lib/adguard/store";
import { encodeQrMatrix, qrToSvgPath } from "@/lib/adguard/qr";
import { useLocale } from "@/lib/i18n/context";
import { cn, Field, textareaClass } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { ChatgptCheck, DnsCheck, useDonorChecks } from "@/components/wizard/donor-checks";
import { ToggleSwitch } from "@/components/wizard/toggle-switch";

type GuideTab = "android" | "ios" | "desktop" | "router";

const CHIP_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60";

const STATUS_POLL_INTERVAL_MS = 5000;
const PREVIEW_DEBOUNCE_MS = 300;

export function AdGuardBuilder() {
  const { t } = useLocale();
  const headingId = useId();
  const guideTabsId = useId();
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>(DEFAULT_DNS_DONOR_SLUG);
  const [sources, setSources] = useState<AdGuardSourceId[]>([...DEFAULT_ADGUARD_SOURCES]);
  const [compress, setCompress] = useState<boolean>(DEFAULT_ADGUARD_COMPRESS);
  const [mode, setMode] = useState<AdGuardMatchMode>(DEFAULT_ADGUARD_MATCH_MODE);
  const [maxIps, setMaxIps] = useState<number>(DEFAULT_ADGUARD_MAX_IPS);
  const [excludeText, setExcludeText] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [guideTab, setGuideTab] = useState<GuideTab>("android");
  const [statuses, setStatuses] = useState<Record<string, DonorStatusSummary>>({});
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewState, setPreviewState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; status: number }
    | { kind: "ready"; lines: string[]; rules: number; domains: number }
  >({ kind: "idle" });

  const { runChecks, statusOf } = useDonorChecks();

  const fetchStatuses = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/adguard/status", { signal });
      if (!res.ok || signal?.aborted) return;
      const data = (await res.json()) as { donors?: DonorStatusSummary[] };
      if (signal?.aborted || !data?.donors) return;
      const map: Record<string, DonorStatusSummary> = {};
      for (const item of data.donors) map[item.slug] = item;
      setStatuses(map);
      setStatusLoaded(true);
    } catch {
      // Ignore aborted or transient status fetch errors.
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    runChecks();
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, [runChecks]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchStatuses(controller.signal);
    return () => controller.abort();
  }, [fetchStatuses]);

  const hasWarming = useMemo(
    () => statusLoaded && DNS_DONORS.some((donor) => !statuses[donor.slug] || statuses[donor.slug].status === "warming"),
    [statusLoaded, statuses]
  );

  useEffect(() => {
    if (!hasWarming) return;
    const controller = new AbortController();
    const interval = setInterval(() => {
      void fetchStatuses(controller.signal);
    }, STATUS_POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, [hasWarming, fetchStatuses]);

  const selectedDonor = useMemo(
    () => DNS_DONORS.find((d) => d.slug === selectedSlug) ?? DNS_DONORS[0],
    [selectedSlug]
  );

  const excludeParsed = useMemo(() => parseExcludeInput(excludeText), [excludeText]);
  const exclude = excludeParsed.valid;

  const excludeError = useMemo(() => {
    const messages: string[] = [];
    if (excludeParsed.invalid.length > 0) {
      const shown = excludeParsed.invalid.slice(0, 3).join(", ");
      const suffix = excludeParsed.invalid.length > 3 ? ` (+${excludeParsed.invalid.length - 3})` : "";
      messages.push(t("adguard.excludeInvalid", { items: `${shown}${suffix}` }));
    }
    if (excludeParsed.overflowCount > 0) {
      messages.push(t("adguard.excludeLimit", { max: MAX_ADGUARD_EXCLUDES, extra: excludeParsed.overflowCount }));
    }
    return messages.length > 0 ? messages.join("\n") : undefined;
  }, [excludeParsed, t]);

  const relativePath = useMemo(
    () => buildAdGuardListPath(selectedDonor.slug, { sources, exclude, mode, compress, maxIps }),
    [selectedDonor.slug, sources, exclude, mode, compress, maxIps]
  );

  const fullUrl = origin ? `${origin}${relativePath}` : relativePath;

  const qrSvg = useMemo(() => {
    if (!origin) return null;
    const matrix = encodeQrMatrix(fullUrl);
    return matrix ? qrToSvgPath(matrix) : null;
  }, [origin, fullUrl]);

  useEffect(() => {
    if (!previewOpen) return;
    const controller = new AbortController();
    setPreviewState({ kind: "loading" });
    const timer = setTimeout(() => {
      fetch(relativePath, { signal: controller.signal })
        .then(async (res) => {
          if (controller.signal.aborted) return;
          if (!res.ok) {
            setPreviewState({ kind: "error", status: res.status });
            return;
          }
          const text = await res.text();
          if (controller.signal.aborted) return;
          const rules = Number(res.headers.get("x-rules-count") ?? 0);
          const domains = Number(res.headers.get("x-domains-count") ?? 0);
          const lines = text.split("\n").slice(0, 35);
          setPreviewState({ kind: "ready", lines, rules, domains });
        })
        .catch(() => {
          if (!controller.signal.aborted) setPreviewState({ kind: "error", status: 0 });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [previewOpen, relativePath]);

  function toggleSource(id: AdGuardSourceId) {
    setSources((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev; // Keep at least one source active.
        return prev.filter((item) => item !== id);
      }
      return ADGUARD_SOURCES.map((s) => s.id).filter((sid) => sid === id || prev.includes(sid));
    });
  }

  function handleRefresh() {
    runChecks();
    void fetchStatuses();
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 2000);
    } catch {
      setCopied(false);
    }
  }

  const donorCheckList = DNS_DONORS.map((donor) => ({ donor, check: statusOf(donor.value) }));
  const checking = donorCheckList.some(({ check }) => check.chatgpt === "checking");

  const guideSteps: Record<GuideTab, string> = {
    android: t("adguard.guideAndroidSteps"),
    ios: t("adguard.guideIosSteps"),
    desktop: t("adguard.guideDesktopSteps"),
    router: t("adguard.guideRouterSteps")
  };

  return (
    <div className="space-y-6">
      {/* Ready link + QR card */}
      <section aria-labelledby={headingId} className="rounded-lg border border-line bg-white p-4 shadow-soft md:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-mint p-2.5 text-moss">
            <Shield className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="text-lg font-semibold text-ink">
              {t("adguard.yourLink", { donor: selectedDonor.label })}
            </h2>
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="rounded-md border border-line bg-paper px-3 py-2.5 font-mono text-xs break-all text-ink select-all">
                  {fullUrl}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={copyUrl}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-ink px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-steel"
                  >
                    {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                    {copied ? t("adguard.copied") : t("adguard.copyLink")}
                  </button>
                  <a
                    href={relativePath}
                    target="_blank"
                    rel="noreferrer"
                    className={CHIP_CLASS}
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    {t("adguard.openRaw")}
                  </a>
                </div>
              </div>

              {origin ? (
                <div className="flex shrink-0 flex-col items-center gap-1.5 rounded-md border border-line bg-white p-2.5">
                  {qrSvg ? (
                    <svg
                      role="img"
                      aria-label={t("adguard.qrTitle")}
                      viewBox={qrSvg.viewBox}
                      className="size-28 rounded bg-white"
                      shapeRendering="crispEdges"
                    >
                      <rect width="100%" height="100%" fill="#ffffff" />
                      <path d={qrSvg.path} fill="#17202a" />
                    </svg>
                  ) : (
                    <p className="w-28 text-center text-[11px] leading-4 text-ink/60">{t("adguard.qrTooLong")}</p>
                  )}
                  <span className="text-[11px] text-ink/55">{t("adguard.qrTitle")}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Collapsible live preview */}
        <details
          onToggle={(event) => setPreviewOpen(event.currentTarget.open)}
          className="group mt-4 border-t border-line pt-3"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-ink/70">
            <span>{t("adguard.previewToggle")}</span>
            <ChevronDown className="size-3.5 text-ink/40 transition group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-2.5">
            {previewState.kind === "loading" ? (
              <p className="text-xs text-ink/55">{t("adguard.previewLoading")}</p>
            ) : previewState.kind === "error" ? (
              <p className="text-xs text-coral">{t("adguard.previewError", { status: previewState.status || "network" })}</p>
            ) : previewState.kind === "ready" ? (
              <div className="space-y-2">
                <div className="text-xs text-ink/60">
                  {t("adguard.previewMeta", { rules: previewState.rules, domains: previewState.domains })}
                </div>
                <pre className="max-h-56 overflow-auto rounded-md border border-line bg-paper p-2.5 font-mono text-[11px] leading-5 text-ink/85">
                  {previewState.lines.join("\n")}
                </pre>
              </div>
            ) : null}
          </div>
        </details>
      </section>

      {/* Donor selector with live DNS / ChatGPT status */}
      <section className="rounded-lg border border-line bg-white p-4 shadow-soft md:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-base font-semibold text-ink">{t("adguard.chooseDonor")}</h2>
            <Tooltip text={t("profiles.donorCheckTooltip")} />
          </div>
          <button type="button" onClick={handleRefresh} disabled={checking} className={CHIP_CLASS}>
            <RefreshCw className={cn("size-3.5", checking && "animate-spin")} aria-hidden="true" />
            {t("monitor.refresh")}
          </button>
        </div>

        <div className="mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-ink/50 *:align-bottom">
                <th scope="col" className="w-full pb-1.5 text-left font-normal">
                  <span className="sr-only">{t("monitor.server")}</span>
                </th>
                <th scope="col" className="hidden whitespace-nowrap pb-1.5 pr-3 text-right font-normal sm:table-cell">
                  {t("adguard.rulesColumn")}
                </th>
                <th scope="col" className="whitespace-nowrap pb-1.5 pr-2 text-left font-normal sm:pr-4">
                  <span className="inline-flex items-center gap-1">
                    DNS
                    <Tooltip text={t("profiles.donorCheckDnsHint")} className="size-3" />
                  </span>
                </th>
                <th scope="col" className="whitespace-nowrap border-l border-line pb-1.5 pl-2 text-left font-normal sm:pl-4">
                  <span className="inline-flex items-center gap-1">
                    ChatGPT
                    <Tooltip text={t("profiles.donorCheckChatgptHint")} className="size-3" align="end" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {donorCheckList.map(({ donor, check }) => {
                const active = donor.slug === selectedDonor.slug;
                const summary = statuses[donor.slug];
                return (
                  <tr
                    key={donor.slug}
                    onClick={() => setSelectedSlug(donor.slug)}
                    className={cn(
                      "cursor-pointer border-t border-line transition-colors",
                      active ? "bg-mint/70 font-medium" : "hover:bg-paper"
                    )}
                  >
                    <th scope="row" className="py-2 pr-2 text-left font-normal">
                      <button
                        type="button"
                        onClick={() => setSelectedSlug(donor.slug)}
                        aria-pressed={active}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full border",
                            active ? "border-moss bg-moss text-white" : "border-line bg-white"
                          )}
                        >
                          {active ? <Check className="size-2.5" aria-hidden="true" /> : null}
                        </span>
                        <span className="text-ink">{donor.label}</span>
                        <span className="hidden font-mono text-[11px] text-ink/45 md:inline">/adguard/{donor.slug}</span>
                      </button>
                    </th>
                    <td className="hidden whitespace-nowrap py-2 pr-3 text-right font-mono text-[11px] text-ink/55 sm:table-cell">
                      {!summary || summary.status === "warming"
                        ? t("adguard.statusWarming")
                        : summary.status === "error"
                          ? <span className="text-coral">{t("adguard.statusError")}</span>
                          : summary.rulesCount}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-2 sm:pr-4">
                      <DnsCheck status={check} />
                    </td>
                    <td className="whitespace-nowrap border-l border-line py-2 pl-2 sm:pl-4">
                      <ChatgptCheck status={check} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Collapsible fine-tuning options */}
      <details className="group rounded-lg border border-line bg-white p-4 shadow-soft md:p-6">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold text-ink">
          <span>{t("adguard.optionsTitle")}</span>
          <ChevronDown className="size-4 text-moss transition group-open:rotate-180" aria-hidden="true" />
        </summary>

        <div className="mt-4 space-y-5">
          {/* Sources */}
          <div>
            <div className="mb-2 text-sm font-medium text-ink">{t("adguard.sourcesLabel")}</div>
            <div className="flex flex-wrap gap-2">
              {ADGUARD_SOURCES.map((source) => {
                const checked = sources.includes(source.id);
                return (
                  <label
                    key={source.id}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                      checked ? "border-moss/50 bg-mint/60 text-ink" : "border-line bg-paper text-ink/65"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSource(source.id)}
                      className="accent-moss"
                    />
                    {source.label}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Match mode */}
          <div>
            <div className="mb-2 text-sm font-medium text-ink">{t("adguard.modeLabel")}</div>
            <div className="flex flex-wrap gap-2">
              {(["sub", "exact"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => setMode(option)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    mode === option ? "border-moss bg-mint text-ink" : "border-line bg-paper text-ink/65 hover:text-ink"
                  )}
                >
                  {option === "sub" ? t("adguard.modeSub") : t("adguard.modeExact")}
                </button>
              ))}
            </div>
          </div>

          {/* Subdomain compression (applies only to subdomain match mode) */}
          {mode === "sub" ? (
            <ToggleSwitch
              checked={compress}
              onChange={setCompress}
              label={t("adguard.compressLabel")}
              tooltip={t("adguard.compressTooltip")}
            />
          ) : null}

          {/* Max IPs per domain */}
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-ink">
              {t("adguard.ipsLabel")}
              <Tooltip text={t("adguard.ipsTooltip")} />
            </div>
            <div className="flex gap-2">
              {Array.from({ length: MAX_ADGUARD_IPS }, (_, index) => index + 1).map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-pressed={maxIps === count}
                  onClick={() => setMaxIps(count)}
                  className={cn(
                    "min-w-10 rounded-md border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors",
                    maxIps === count ? "border-moss bg-mint text-ink" : "border-line bg-paper text-ink/65 hover:text-ink"
                  )}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          {/* Exclusions */}
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                {t("adguard.excludeLabel")}
                <Tooltip text={t("adguard.excludeTooltip")} />
              </span>
            }
            error={excludeError}
          >
            <textarea
              className={textareaClass}
              value={excludeText}
              onChange={(event) => setExcludeText(event.target.value)}
              placeholder={t("adguard.excludePlaceholder")}
            />
          </Field>
        </div>
      </details>

      {/* Platform setup guide */}
      <section className="rounded-lg border border-line bg-white p-4 shadow-soft md:p-6">
        <h2 className="text-base font-semibold text-ink">{t("adguard.guideTitle")}</h2>
        <div role="tablist" className="mt-3 flex flex-wrap gap-1.5 border-b border-line pb-3">
          {(
            [
              ["android", t("adguard.guideAndroid")],
              ["ios", t("adguard.guideIos")],
              ["desktop", t("adguard.guideDesktop")],
              ["router", t("adguard.guideRouter")]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              id={`${guideTabsId}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={guideTab === id}
              aria-controls={`${guideTabsId}-panel`}
              onClick={() => setGuideTab(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                guideTab === id ? "bg-mint text-ink" : "text-ink/60 hover:bg-paper hover:text-ink"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          id={`${guideTabsId}-panel`}
          role="tabpanel"
          aria-labelledby={`${guideTabsId}-tab-${guideTab}`}
          className="mt-3"
        >
          <p className="text-sm leading-6 text-ink/80">{guideSteps[guideTab]}</p>
          <p className="mt-2 text-xs leading-5 text-ink/55">{t("adguard.vpnCaveat")}</p>
        </div>
      </section>
    </div>
  );
}
