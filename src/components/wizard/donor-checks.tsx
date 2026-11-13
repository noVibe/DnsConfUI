"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BLOCKED_COUNTRIES, DNS_DONORS } from "@/domain/dns-donors";
import { checkDonor, visitorCountry, type DonorCheck } from "@/lib/dns/donor-check";
import { useLocale } from "@/lib/i18n/context";
import { cn } from "@/components/ui";

type Status = "checking" | "ok" | "fail";

function toStatus(ms: number | null | undefined): Status {
  return ms === undefined ? "checking" : ms === null ? "fail" : "ok";
}

const PRESETS = DNS_DONORS.map((donor) => donor.value);

/** One finished check, as the promise from `check`/`runChecks` reports it. */
export type CheckedDonor = { readonly donor: string; readonly check: DonorCheck };

/**
 * Runs availability checks: `check` for the given DoH URLs, `runChecks` for every preset (plus `extra`).
 *
 * Both return a promise that settles once every requested check has an answer, and resolve with those answers, so a
 * caller that needs to act on the whole set (ranking the donors, say) can await it instead of watching the rendered
 * statuses go by. `statusOf` stays the way the UI reads them.
 */
export function useDonorChecks() {
  const { t } = useLocale();
  const pending = useRef(new Map<string, Promise<DonorCheck>>());
  const [checks, setChecks] = useState<Record<string, DonorCheck>>({});

  const check = useCallback((donors: string[]): Promise<CheckedDonor[]> => {
    // A donor that is still being checked is left alone: its result is on the way.
    const fresh = donors.filter((donor) => !pending.current.has(donor));
    setChecks((prev) => {
      const next = { ...prev };
      fresh.forEach((donor) => delete next[donor]);
      return next;
    });
    const requested = donors.map((donor) => {
      const started = pending.current.get(donor);
      if (started) return { donor, request: started };
      const request = checkDonor(donor);
      pending.current.set(donor, request);
      request.then((result) => {
        // A result of a check dropped on unmount is ignored.
        if (pending.current.get(donor) !== request) return;
        pending.current.delete(donor);
        setChecks((prev) => ({ ...prev, [donor]: result }));
      });
      return { donor, request };
    });
    // `checkDonor` answers a failure rather than rejecting, so this settles once for every donor either way.
    return Promise.all(requested.map(async ({ donor, request }) => ({ donor, check: await request })));
  }, []);

  const runChecks = useCallback((extra: string[] = []) => check([...PRESETS, ...extra]), [check]);

  const [visitor, setVisitor] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    visitorCountry().then((country) => { if (mounted) setVisitor(country); });
    return () => {
      mounted = false;
      pending.current.clear();
    };
  }, []);

  function statusOf(donor: string) {
    const check = checks[donor];
    const direct = check?.direct ?? false;
    // Without a proxy, chatgpt.com sees the visitor's own country, so the blocked-country rule applies to it.
    const country = direct ? visitor : check?.country ?? null;
    const chatgptMs = check ? (direct && country && BLOCKED_COUNTRIES.has(country) ? null : check.chatgptMs) : undefined;
    const dns = toStatus(check?.dnsMs);
    const chatgpt = toStatus(chatgptMs);
    const dnsKey = { checking: "profiles.donorCheckDnsChecking", ok: "profiles.donorCheckDnsOk", fail: "profiles.donorCheckDnsFail" } as const;
    const chatgptKey = {
      checking: "profiles.donorCheckChatgptChecking",
      ok: direct ? (country ? "profiles.donorCheckChatgptDirect" : "profiles.donorCheckChatgptDirectUnknown") : "profiles.donorCheckChatgptOk",
      fail: direct && country ? "profiles.donorCheckChatgptDirectBlocked" : country ? "profiles.donorCheckChatgptBlocked" : "profiles.donorCheckChatgptFail"
    } as const;
    return {
      dns,
      chatgpt,
      country,
      direct,
      dnsMs: check?.dnsMs ?? null,
      chatgptMs: chatgptMs ?? null,
      dnsText: t(dnsKey[dns], { ms: check?.dnsMs ?? 0 }),
      chatgptText: t(chatgptKey[chatgpt], { ms: chatgptMs ?? 0, country: country ?? "" })
    };
  }

  return { check, runChecks, statusOf };
}

export type DonorStatus = ReturnType<ReturnType<typeof useDonorChecks>["statusOf"]>;

export function StatusIcon({ status, label }: { status: Status; label: string }) {
  const Icon = status === "checking" ? Loader2 : status === "ok" ? CheckCircle2 : XCircle;
  return (
    <span title={label} className="inline-flex shrink-0">
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5",
          status === "checking" && "animate-spin text-ink/40",
          status === "ok" && "text-moss",
          status === "fail" && "text-coral"
        )}
      />
    </span>
  );
}

function Detail({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span aria-hidden="true" className={cn("text-[11px] font-normal tabular-nums text-ink/50", className)}>{children}</span>;
}

export function DnsCheck({ status }: { status: DonorStatus }) {
  const { t } = useLocale();
  return (
    <span className="flex items-center gap-1">
      <span className="sr-only">{status.dnsText}</span>
      {/* Time first, then status, with a fixed time slot, as in the other columns. */}
      <Detail className="min-w-[2.75rem] text-right">{status.dnsMs !== null ? t("profiles.donorCheckMs", { ms: status.dnsMs }) : null}</Detail>
      <StatusIcon status={status.dns} label={status.dnsText} />
    </span>
  );
}

export function ChatgptCheck({ status, className }: { status: DonorStatus; className?: string }) {
  const { t } = useLocale();
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <span className="sr-only">{status.chatgptText}</span>
      {/* Fixed slots keep the country codes lined up in one column across rows. */}
      <Detail className={cn("w-5 text-center font-medium", status.chatgpt === "fail" ? "text-coral" : "text-ink/60")}>{status.country}</Detail>
      <Detail className="min-w-[2.75rem] text-right">
        {status.chatgptMs !== null ? t("profiles.donorCheckMs", { ms: status.chatgptMs }) : null}
      </Detail>
      <StatusIcon status={status.chatgpt} label={status.chatgptText} />
    </span>
  );
}
