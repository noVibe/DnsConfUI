"use client";

import { ChevronDown } from "lucide-react";
import { useLocale } from "@/lib/i18n/context";

export function CredsGuide() {
  const { t } = useLocale();
  return (
    <details className="rounded-lg border border-moss/30 bg-white p-4 shadow-soft">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink">
        {t("home.whereCreds")}
        <ChevronDown className="size-4 text-moss" aria-hidden="true" />
      </summary>
      <div className="mt-4 space-y-3 text-sm leading-6 text-ink/72">

        <details className="rounded-md border border-line bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink">
            {t("home.nextdns")}
            <ChevronDown className="size-3.5 text-moss" aria-hidden="true" />
          </summary>
          <div className="border-t border-line px-4 pb-4 pt-3 space-y-3">
            <div className="rounded-md bg-paper p-3">
              <div className="font-medium text-ink">{t("home.clientId")}</div>
              <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-ink/70">
                <li>{t("home.clientId.nextdns.1")} <a className="text-steel underline hover:text-ink" href="https://my.nextdns.io" target="_blank" rel="noreferrer">{t("home.nextdnsSetupPage")}</a></li>
                <li>{t("home.clientId.nextdns.2")}</li>
              </ol>
            </div>
            <div className="rounded-md bg-paper p-3">
              <div className="font-medium text-ink">{t("home.authSecret")}</div>
              <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-ink/70">
                <li>{t("home.authSecret.nextdns.1")} <a className="text-steel underline hover:text-ink" href="https://my.nextdns.io/account" target="_blank" rel="noreferrer">my.nextdns.io/account</a></li>
                <li>{t("home.authSecret.nextdns.2")}</li>
              </ol>
            </div>
          </div>
        </details>

        <details className="rounded-md border border-line bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink">
            {t("home.cloudflare")}
            <ChevronDown className="size-3.5 text-moss" aria-hidden="true" />
          </summary>
          <div className="border-t border-line px-4 pb-4 pt-3 space-y-3">
            <div className="rounded-md bg-paper p-3">
              <div className="font-medium text-ink">{t("home.clientId")}</div>
              <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-ink/70">
                <li>{t("home.clientId.cf.1")} <a className="text-steel underline hover:text-ink" href="https://dash.cloudflare.com" target="_blank" rel="noreferrer">{t("home.dashCloudflare")}</a></li>
                <li>{t("home.clientId.cf.2")}</li>
                <li>{t("home.clientId.cf.3")}</li>
                <li>{t("home.clientId.cf.4")} <a className="text-steel underline hover:text-ink" href="https://dash.cloudflare.com/?to=/:account/workers" target="_blank" rel="noreferrer">dash.cloudflare.com/?to=/:account/workers</a></li>
                <li>{t("home.clientId.cf.5")}</li>
              </ol>
            </div>
            <div className="rounded-md bg-paper p-3">
              <div className="font-medium text-ink">{t("home.authSecret")}</div>
              <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-ink/70">
                <li>{t("home.authSecret.cf.1")} <a className="text-steel underline hover:text-ink" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">dash.cloudflare.com/profile/api-tokens</a></li>
                <li>
                  {t("home.authSecret.cf.2")}
                  <ul className="mt-1 space-y-0.5 list-disc pl-5">
                    <li><code className="rounded bg-paper px-1 text-xs">{t("home.authSecret.cf.perm1")}</code></li>
                    <li><code className="rounded bg-paper px-1 text-xs">{t("home.authSecret.cf.perm2")}</code></li>
                  </ul>
                </li>
              </ol>
            </div>
          </div>
        </details>

      </div>
    </details>
  );
}
