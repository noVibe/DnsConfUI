"use client";

import { Eye, EyeClosed, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { DNS_DONORS, isDnsDonorPreset } from "@/domain/dns-donors";
import { useLocale } from "@/lib/i18n/context";
import { cn } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { useCustomDonors } from "@/components/wizard/custom-donors";
import { useHiddenDonors } from "@/components/wizard/hidden-donors";
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
  const nameId = useId();
  const { check, runChecks, statusOf } = useDonorChecks();
  const { donors: kept, add, remove } = useCustomDonors();
  const { hidden, toggle } = useHiddenDonors();
  /** Whether the hidden rows are on screen right now. Not remembered: hiding is the preference, looking is not. */
  const [revealed, setRevealed] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [name, setName] = useState("");
  const [addFailed, setAddFailed] = useState(false);
  const listed = [...DNS_DONORS, ...kept];
  const statuses = listed.map((donor) => ({ donor, status: statusOf(donor.value) }));
  const hiddenCount = listed.filter((donor) => hidden.has(donor.value)).length;
  // Hidden rows are still checked, so revealing one shows an answer rather than a row that has to start over.
  const shown = revealed ? statuses : statuses.filter(({ donor }) => !hidden.has(donor.value));
  const eyeLabel = revealed
    ? t("monitor.hidden.collapse", { count: hiddenCount })
    : t("monitor.hidden.show", { count: hiddenCount });
  const customStatus = custom ? statusOf(custom) : null;
  const checking = [...statuses.map(({ status }) => status), ...(customStatus ? [customStatus] : [])]
    .some((status) => status.chatgpt === "checking");
  const extra = kept.map((donor) => donor.value).join(" ");

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  // The added servers arrive from this container a moment later than the presets, and only they are checked then:
  // the presets are already on their way, and `check` leaves a check that is still out alone.
  useEffect(() => {
    if (extra) void check(extra.split(" "));
  }, [check, extra]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const typed = input.trim();
    // People often paste a bare host, so a missing scheme means HTTPS.
    const value = /^[a-z][a-z\d+.-]*:\/\//i.test(typed) || !typed ? typed : `https://${typed}`;
    setInvalid(!isHttpsUrl(value));
    if (!isHttpsUrl(value)) return;
    setAddFailed(false);
    // A preset, or one already added, is listed already: it is rechecked in place instead of being added twice.
    const known = isDnsDonorPreset(value) || kept.some((donor) => donor.value === value);
    setCustom(known ? null : value);
    if (!known) setName(new URL(value).host);
    check([value]);
  }

  async function keep() {
    if (!custom) return;
    const added = await add(custom, name.trim() || new URL(custom).host);
    setAddFailed(!added);
    if (!added) return;
    // It is in the list proper now, under its own name, with the check it has just passed.
    setCustom(null);
    setInput("");
  }

  return (
    <section aria-labelledby={headingId} className="w-full rounded-lg border border-line bg-white p-4 shadow-soft md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 id={headingId} className="whitespace-nowrap text-base font-semibold text-ink">{t("monitor.title")}</h2>
          <Tooltip text={t("profiles.donorCheckTooltip")} />
        </div>
        <button
          type="button"
          onClick={() => runChecks([...kept.map((donor) => donor.value), ...(custom ? [custom] : [])])}
          disabled={checking}
          className={BUTTON_CLASS}
        >
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
              <th scope="col" className="whitespace-nowrap border-l border-line pb-1.5 pl-2 pr-2 text-left font-normal sm:pl-4 sm:pr-3"><span className="inline-flex items-center gap-1">ChatGPT<Tooltip text={t("profiles.donorCheckChatgptHint")} className="size-3" /></span></th>
              <th scope="col" className="w-0 pb-1.5 pl-1 text-right font-normal">
                <span className="sr-only">{t("monitor.hidden.column")}</span>
                {/* Nothing hidden, nothing to unfold: the eye appears when it has something to say. */}
                {hiddenCount > 0 ? (
                  <Tooltip text={eyeLabel}>
                    <button
                      type="button"
                      onClick={() => setRevealed((on) => !on)}
                      // The count and what the click does are the whole message, so they are the button's own name.
                      aria-label={eyeLabel}
                      aria-expanded={revealed}
                      className="inline-flex rounded p-0.5 text-moss transition-colors hover:text-steel"
                    >
                      {/* Open while they are on screen, closed while they are not: the lid is the state. */}
                      {revealed
                        ? <Eye className="size-3.5" aria-hidden="true" />
                        : <EyeClosed className="size-3.5" aria-hidden="true" />}
                    </button>
                  </Tooltip>
                ) : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ donor, status }) => (
              <tr key={donor.value} className={cn("border-t border-line", hidden.has(donor.value) && "opacity-50")}>
                <th scope="row" className="whitespace-nowrap py-1.5 pr-2 text-left font-normal sm:pr-4">
                  <span className="flex items-center gap-1.5">
                    {donor.site ? (
                      <a href={donor.site} target="_blank" rel="noreferrer" className="text-ink underline decoration-ink/25 underline-offset-2 transition-colors hover:text-steel hover:decoration-steel">
                        {donor.label}
                      </a>
                    ) : donor.label}
                    {/* Only the added ones can go: a preset is part of the app, and nothing here would bring it back. */}
                    {isDnsDonorPreset(donor.value) ? null : (
                      <button
                        type="button"
                        onClick={() => void remove(donor.value)}
                        aria-label={t("monitor.custom.forget", { label: donor.label })}
                        className="rounded text-ink/40 transition-colors hover:text-coral"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </th>
                <td className="whitespace-nowrap py-1.5 pr-2 sm:pr-4"><DnsCheck status={status} /></td>
                <td className="whitespace-nowrap border-l border-line py-1.5 pl-2 pr-2 sm:pl-4 sm:pr-3"><ChatgptCheck status={status} /></td>
                <td className="py-1.5 pl-1 text-right">
                  <Tooltip text={t(hidden.has(donor.value) ? "monitor.unhide" : "monitor.hide", { label: donor.label })}>
                    <button
                      type="button"
                      onClick={() => toggle(donor.value)}
                      aria-label={t(hidden.has(donor.value) ? "monitor.unhide" : "monitor.hide", { label: donor.label })}
                      className="inline-flex rounded p-0.5 text-ink/30 transition-colors hover:text-ink/70"
                    >
                      {hidden.has(donor.value)
                        ? <EyeClosed className="size-3.5" aria-hidden="true" />
                        : <Eye className="size-3.5" aria-hidden="true" />}
                    </button>
                  </Tooltip>
                </td>
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
                {/* Nothing to hide here: this row goes away by itself as soon as it is kept or dropped. */}
                <td className="pl-1" />
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

      {/* A server that answers is worth keeping in the table, and worth offering to the file builder. */}
      {custom && customStatus?.dns === "ok" ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs text-ink/70">{t("monitor.custom.worksTitle")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <label htmlFor={nameId} className="sr-only">{t("monitor.custom.nameLabel")}</label>
            <input
              id={nameId}
              value={name}
              onChange={(event) => { setName(event.target.value); setAddFailed(false); }}
              maxLength={24}
              placeholder={t("monitor.custom.nameLabel")}
              className="h-8 w-40 min-w-0 rounded-md border border-line bg-white px-2 text-xs text-ink outline-none placeholder:text-ink/35 focus:border-steel focus:ring-2 focus:ring-steel/20"
            />
            <button type="button" onClick={keep} className={BUTTON_CLASS}>{t("monitor.custom.add")}</button>
          </div>
          <p className="mt-1.5 text-xs text-ink/50">{t("monitor.custom.addHint")}</p>
          {addFailed ? <p className="mt-1.5 text-xs text-coral">{t("monitor.custom.addFailed")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
