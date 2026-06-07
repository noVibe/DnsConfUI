"use client";

import { ChevronDown } from "lucide-react";
import { useLocale } from "@/lib/i18n/context";

export function ScriptBehaviour({ provider }: { provider: "cloudflare" | "nextdns" }) {
  const { t } = useLocale();
  return (
    <details className="group mt-2 text-sm leading-6 text-ink/72">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink/60">
        <ChevronDown className="size-3.5 text-moss transition group-open:rotate-180" aria-hidden="true" />
        {t('script.title')}
      </summary>
      {provider === "nextdns" ? (
        <div className="mt-2 space-y-1.5">
          <p>{t('script.oldSettings')}</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>{t('script.noSources')}</li>
            <li>{t('script.eachLine')}</li>
            <li>{t('script.oneType')}</li>
            <li>{t('script.excludeRedirect')}</li>
            <li>{t('script.rateLimit')}</li>
          </ul>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          <p>{t('script.previousData')}</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>{t('script.clearCF')}</li>
            <li>{t('script.eachLineCF')}</li>
          </ul>
        </div>
      )}
    </details>
  );
}
