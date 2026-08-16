"use client";

import { ChevronDown } from "lucide-react";
import type { buildDnsConfPayload } from "@/domain/dnsconf-config";
import { DISABLED_DNS_DONOR, getDnsDonorLabel } from "@/domain/dns-donors";
import { useLocale } from "@/lib/i18n/context";
import { SummaryLine } from "./summary-line";

export function ReviewPanel({
  payload,
  valid,
  retainCredentials = false
}: {
  payload: ReturnType<typeof buildDnsConfPayload> | null;
  valid: boolean;
  retainCredentials?: boolean;
}) {
  const { t } = useLocale();
  if (!valid || !payload) {
    return (
      <section className="rounded-lg border border-coral/30 bg-coral/10 p-4 text-sm text-ink">
        {t('review.desc')}
      </section>
    );
  }

  return (
    <details className="group rounded-lg border border-line bg-paper">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink">
        {t('review.title')}
        <ChevronDown className="size-4 text-moss transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-line px-4 pb-4 pt-3 text-sm text-ink/72">
        {(() => {
          const ids = (payload.secrets.CLIENT_ID ?? "").split(",");
          const secrets = (payload.secrets.AUTH_SECRET ?? "").split(",");
          const dns = payload.variables.DNS.split(",");
          const donors = payload.variables.DONOR_DNS.split(",");
          const profileCount = retainCredentials ? dns.length : ids.length;
          return (
            <div className="space-y-2">
              {Array.from({ length: profileCount }, (_, i) => (
                <div key={i} className="rounded-md border border-line bg-white px-3 py-2">
                  <div className="font-medium text-ink">{t('review.profile', { n: i + 1 })}</div>
                  {retainCredentials ? (
                    <div className="mt-1 text-ink/70">{t('review.credentialsRetained')}</div>
                  ) : (
                    <>
                      <div className="mt-1 text-ink/70">{t('review.id', { value: ids[i] ?? "" })}</div>
                      <div className="text-ink/70">{t('review.secret', { value: "*".repeat(Math.min(secrets[i]?.length ?? 0, 20)) })}</div>
                    </>
                  )}
                  <div className="text-ink/70">{t('review.dns', { value: dns[i] ?? "" })}</div>
                  <div className="text-ink/70">{t('review.donor', { value: donors[i] === DISABLED_DNS_DONOR ? t('review.donorDisabled') : getDnsDonorLabel(donors[i] ?? "") ?? donors[i] ?? "" })}</div>
                </div>
              ))}
            </div>
          );
        })()}
        <SummaryLine label="BLOCK" value={payload.variables.BLOCK || t('review.none')} />
        <SummaryLine label="REDIRECT" value={payload.variables.REDIRECT || t('review.none')} />
        <SummaryLine label="EXCLUDE_REDIRECT" value={payload.variables.EXCLUDE_REDIRECT || t('review.none')} />
      </div>
    </details>
  );
}
