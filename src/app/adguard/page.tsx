"use client";

import Link from "next/link";
import { ArrowLeft, Globe, Moon, Sun } from "lucide-react";
import { AdGuardBuilder } from "@/components/adguard-builder";
import { useLocale } from "@/lib/i18n/context";
import { useTheme } from "@/lib/theme/context";

export default function AdGuardPage() {
  const { t, locale, setLocale } = useLocale();
  const { theme, toggleTheme } = useTheme();

  return (
    <main className="min-h-screen">
      <section className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-6 md:grid-cols-[0.62fr_1.38fr] md:px-8 md:py-8">
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-moss/30 bg-mint/70 p-4 shadow-sm dark:bg-paper">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setLocale(locale === "ru" ? "en" : "ru")}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink/60 transition-colors hover:border-ink/30 hover:text-ink"
              >
                <Globe className="size-3.5" aria-hidden="true" />
                {locale === "ru" ? "English" : "Русский"}
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink/60 transition-colors hover:border-ink/30 hover:text-ink"
              >
                {theme === "light" ? <Moon className="size-3.5" aria-hidden="true" /> : <Sun className="size-3.5" aria-hidden="true" />}
                {theme === "light" ? t("home.theme.dark") : t("home.theme.light")}
              </button>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink/60 transition-colors hover:border-ink/30 hover:text-ink"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                {t("adguard.backHome")}
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-white/80 p-4 shadow-sm">
            <div className="text-sm font-medium text-ink/60">AdGuard</div>
            <h1 className="mt-1 text-3xl font-semibold leading-[1.1] text-ink md:text-4xl">
              {t("adguard.title")}
            </h1>
          </div>

          <div className="max-w-xl">
            <p className="text-base leading-7 text-ink/72">
              {t("adguard.subtitle")}
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <AdGuardBuilder />
        </div>
      </section>
    </main>
  );
}
