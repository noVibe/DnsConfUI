"use client";

import { ChevronDown, Globe, Layers, MapPin, RefreshCw, ShieldCheck, GitFork, Play, Zap, Sun, Moon } from "lucide-react";
import { DeviceAuthPanel } from "@/components/device-auth-panel";
import { SetupWizard } from "@/components/setup-wizard";
import { useAuth } from "@/components/auth-provider";
import { useLocale } from "@/lib/i18n/context";
import { useTheme } from "@/lib/theme/context";

export default function Home() {
  const { token } = useAuth();
  const { t, locale, setLocale } = useLocale();
  const { theme, toggleTheme } = useTheme();

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
      icon: Play,
      title: t("points.run.title"),
      text: t("points.run.text"),
    },
  ];

  return (
    <main className="min-h-screen">
      <section className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-6 md:grid-cols-[0.62fr_1.38fr] md:px-8 md:py-8">
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-moss/30 bg-mint/70 p-4 shadow-sm dark:border-moss/30 dark:bg-paper">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setLocale(locale === "ru" ? "en" : "ru")}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink/60 hover:text-ink hover:border-ink/30 transition-colors"
              >
                <Globe className="size-3.5" aria-hidden="true" />
                {locale === "ru" ? "English" : "Русский"}
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink/60 hover:text-ink hover:border-ink/30 transition-colors"
              >
                {theme === "light" ? <Moon className="size-3.5" aria-hidden="true" /> : <Sun className="size-3.5" aria-hidden="true" />}
                {theme === "light" ? t("home.theme.dark") : t("home.theme.light")}
              </button>
            </div>
          </div>
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

          <details className="rounded-lg border border-line bg-white/80 p-4 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink">
              {t("home.whatIs")}
              <ChevronDown className="size-4 text-moss" aria-hidden="true" />
            </summary>
            <div className="mt-4 grid gap-3">
              <div className="grid grid-cols-[auto_1fr] gap-3">
                <MapPin className="mt-1 size-4 text-coral" aria-hidden="true" />
                <p className="text-sm leading-6 text-ink/72">{t("home.whatIs.1")}</p>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-3">
                <ShieldCheck className="mt-1 size-4 text-coral" aria-hidden="true" />
                <p className="text-sm leading-6 text-ink/72">{t("home.whatIs.2")}</p>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-3">
                <RefreshCw className="mt-1 size-4 text-coral" aria-hidden="true" />
                <p className="text-sm leading-6 text-ink/72">{t("home.whatIs.3")}</p>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-3">
                <Layers className="mt-1 size-4 text-coral" aria-hidden="true" />
                <p className="text-sm leading-6 text-ink/72">{t("home.whatIs.4")}</p>
              </div>
            </div>
            {locale === "ru" ? (
              <div className="mt-3 border-t border-line pt-3 text-xs text-ink/50">
                <a href="https://habr.com/ru/articles/984224/" target="_blank" rel="noreferrer" className="hover:text-ink/70 hover:underline">Статья на Хабр: Доступ к ChatGPT за 5 минут без VPN</a>
              </div>
            ) : null}
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

          <div className="flex items-center gap-2 text-xs text-ink/40">
            <span>GitHub:</span>
            <a href="https://github.com/noVibe/DnsConfUI" target="_blank" rel="noreferrer" className="hover:text-ink/70 hover:underline transition-colors">noVibe/DnsConfUI</a>
            <span className="text-ink/20">|</span>
            <a href="https://github.com/noVibe/DnsConf" target="_blank" rel="noreferrer" className="hover:text-ink/70 hover:underline transition-colors">noVibe/DnsConf</a>
          </div>
        </div>

        <div>
          <div className="w-full rounded-lg border border-line bg-white p-4 shadow-soft md:p-6">
            {token ? <SetupWizard /> : <DeviceAuthPanel />}
          </div>
        </div>
      </section>
    </main>
  );
}
