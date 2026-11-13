"use client";

import { RefreshCw, X } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { DNS_DONORS, isDnsDonorPreset } from "@/domain/dns-donors";
import { useLocale } from "@/lib/i18n/context";
import { cn } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { ChatgptCheck, DnsCheck, useDonorChecks } from "@/components/wizard/donor-checks";

const BUTTON_CLASS = "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink/60 transition-colors hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60";

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function DnsMonitor() {
  const { t } = useLocale();
  const headingId = useId();
  const inputId = useId();
  const errorId = useId();
  const { check, runChecks, statusOf } = useDonorChecks();
  const [custom, setCustom] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const statuses = DNS_DONORS.map((donor) => ({ donor, status: statusOf(donor.value) }));
  const customStatus = custom ? statusOf(custom) : null;
  const checking = [...statuses.map(({ status }) => status), ...(customStatus ? [customStatus] : [])]
    .some((status) => status.chatgpt === "checking");

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const typed = input.trim();
    // People often paste a bare host, so a missing scheme means HTTPS.
    const value = /^[a-z][a-z\d+.-]*:\/\//i.test(typed) || !typed ? typed : `https://${typed}`;
    setInvalid(!isHttpsUrl(value));
    if (!isHttpsUrl(value)) return;
    // A preset is already listed, so it is rechecked in place instead of being added twice.
    setCustom(isDnsDonorPreset(value) ? null : value);
    check([value]);
  }

  return (
    <section aria-labelledby={headingId} className="w-full rounded-lg border border-line bg-white p-4 shadow-soft md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 id={headingId} className="whitespace-nowrap text-base font-semibold text-ink">{t("monitor.title")}</h2>
          <Tooltip text={t("profiles.donorCheckTooltip")} />
        </div>
        <button type="button" onClick={() => runChecks(custom ? [custom] : [])} disabled={checking} className={BUTTON_CLASS}>
          <RefreshCw className={cn("size-3.5", checking && "animate-spin")} aria-hidden="true" />
          {t("monitor.refresh")}
        </button>
      </div>
      {/* No overflow scrolling here: it would clip the header tooltips, so the columns are sized to fit phones instead. */}
      <div className="mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-ink/50 *:align-bottom">
              <th scope="col" className="w-full pb-1.5 text-left font-normal"><span className="sr-only">{t("monitor.server")}</span></th>
              <th scope="col" className="whitespace-nowrap pb-1.5 pr-2 text-left font-normal sm:pr-4"><span className="inline-flex items-center gap-1">DNS<Tooltip text={t("profiles.donorCheckDnsHint")} className="size-3" /></span></th>
              <th scope="col" className="whitespace-nowrap border-l border-line pb-1.5 pl-2 pr-2 text-left font-normal sm:pl-4 sm:pr-3"><span className="inline-flex items-center gap-1">ChatGPT<Tooltip text={t("profiles.donorCheckChatgptHint")} className="size-3" align="end" /></span></th>
            </tr>
          </thead>
          <tbody>
            {statuses.map(({ donor, status }) => (
              <tr key={donor.value} className="border-t border-line">
                <th scope="row" className="whitespace-nowrap py-1.5 pr-2 text-left font-normal sm:pr-4">
                  {donor.site ? (
                    <a href={donor.site} target="_blank" rel="noreferrer" className="text-ink underline decoration-ink/25 underline-offset-2 transition-colors hover:text-steel hover:decoration-steel">
                      {donor.label}
                    </a>
                  ) : donor.label}
                </th>
                <td className="whitespace-nowrap py-1.5 pr-2 sm:pr-4"><DnsCheck status={status} /></td>
                <td className="whitespace-nowrap border-l border-line py-1.5 pl-2 pr-2 sm:pl-4 sm:pr-3"><ChatgptCheck status={status} /></td>
              </tr>
            ))}
            {custom && customStatus ? (
              <tr className="border-t border-line bg-mint/40">
                <th scope="row" className="whitespace-nowrap py-1.5 pr-2 text-left font-normal sm:pr-4">
                  <span className="flex items-center gap-1.5">
                    <span title={custom} className="max-w-[9rem] truncate">{new URL(custom).host}</span>
                    <span className="text-[11px] text-ink/50">{t("monitor.custom.tag")}</span>
                    <button
                      type="button"
                      onClick={() => setCustom(null)}
                      aria-label={t("monitor.custom.remove")}
                      className="rounded text-ink/40 transition-colors hover:text-coral"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </th>
                <td className="whitespace-nowrap py-1.5 pr-2 sm:pr-4"><DnsCheck status={customStatus} /></td>
                <td className="whitespace-nowrap border-l border-line py-1.5 pl-2 pr-2 sm:pl-4 sm:pr-3"><ChatgptCheck status={customStatus} /></td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <form onSubmit={submit} noValidate className="mt-4 border-t border-line pt-3">
        <label htmlFor={inputId} className="text-xs font-medium text-ink/70">{t("monitor.custom.label")}</label>
        <div className="mt-1.5 flex gap-2">
          <input
            id={inputId}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(event) => { setInput(event.target.value); setInvalid(false); }}
            placeholder="https://example.com/dns-query"
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            className={cn(
              "h-8 min-w-0 flex-1 rounded-md border border-line bg-white px-2 text-xs text-ink outline-none placeholder:text-ink/35 focus:border-steel focus:ring-2 focus:ring-steel/20",
              invalid && "border-coral"
            )}
          />
          <button type="submit" className={BUTTON_CLASS}>{t("monitor.custom.check")}</button>
        </div>
        {invalid ? <p id={errorId} className="mt-1.5 text-xs text-coral">{t("monitor.custom.invalid")}</p> : null}
      </form>
    </section>
  );
}
