"use client";

import { ChevronDown, ShieldCheck, GitFork, Play, Workflow, Zap } from "lucide-react";
import { DeviceAuthPanel } from "@/components/device-auth-panel";
import { SetupWizard } from "@/components/setup-wizard";
import { useAuth } from "@/components/auth-provider";
import { useLocale } from "@/lib/i18n/context";

export default function Home() {
  const { token } = useAuth();
  const { t } = useLocale();

  const points = [
    {
      icon: Zap,
      title: t("points.quick.title"),
      text: t("points.quick.text"),
    },
    {
      icon: GitFork,
      title: t("points.fork.title"),
      text: t("points.fork.text"),
    },
    {
      icon: ShieldCheck,
      title: t("points.nocred.title"),
      text: t("points.nocred.text"),
    },
    {
      icon: Workflow,
      title: t("points.workflow.title"),
      text: t("points.workflow.text"),
    },
    {
      icon: Play,
      title: t("points.run.title"),
      text: t("points.run.text"),
    },
  ];

  return (
    <main className="min-h-screen">
      <section className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-6 md:grid-cols-[0.62fr_1.38fr] md:px-8 md:py-8">
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-line bg-white/80 p-4 shadow-sm">
            <div className="text-sm font-medium text-ink/60">
              {t("home.title")}
            </div>
            <h1 className="mt-1 text-4xl font-semibold leading-[1.04] text-ink md:text-5xl">
              <a className="hover:underline" href="https://github.com/noVibe/DnsConf" target="_blank" rel="noreferrer">noVibe/DnsConf</a>
            </h1>
          </div>
          <div className="max-w-xl">
            <p className="text-base leading-7 text-ink/72">
              {t("home.description")}
            </p>
          </div>

          <details className="rounded-lg border border-line bg-white/80 p-4 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink">
              {t("home.why")}
              <ChevronDown className="size-4 text-moss" aria-hidden="true" />
            </summary>
            <div className="mt-4 grid gap-3">
              {points.map((point) => (
                <div key={point.title} className="grid grid-cols-[auto_1fr] gap-3">
                  <point.icon className="mt-1 size-4 text-coral" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-semibold text-ink">{point.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-ink/70">{point.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </details>

          {token ? (
            <details className="rounded-lg border border-line bg-white/80 p-4 shadow-sm">
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
          ) : null}
        </div>

        <div>
          <div className="w-full rounded-lg border border-line bg-white p-4 shadow-soft md:p-6">
            {token ? <SetupWizard /> : <DeviceAuthPanel />}
          </div>
        </div>
      </section>
      <footer className="pb-6 text-center text-sm text-ink/48">
        <a href="https://github.com/noVibe/DnsConfUI" target="_blank" rel="noreferrer" className="hover:text-ink/72 hover:underline">
          {t("home.footer")}
        </a>
      </footer>
    </main>
  );
}
