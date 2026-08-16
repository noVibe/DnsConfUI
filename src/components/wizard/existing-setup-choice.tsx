"use client";

import { KeyRound, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import type { ExistingDnsConfSetup } from "@/lib/github/provisioning";
import { useLocale } from "@/lib/i18n/context";
import { Button, SecondaryButton } from "@/components/ui";

export function ExistingSetupChoice({
  loading,
  error,
  setup,
  onRetry,
  onConfigureFromScratch,
  onRetainCredentials
}: {
  loading: boolean;
  error: string;
  setup: ExistingDnsConfSetup | null;
  onRetry: () => void;
  onConfigureFromScratch: () => void;
  onRetainCredentials: () => void;
}) {
  const { t } = useLocale();

  if (loading) {
    return (
      <section className="flex min-h-48 items-center justify-center gap-2 text-sm text-ink/65">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {t("existing.checking")}
      </section>
    );
  }

  if (error) {
    return (
      <section className="space-y-4 rounded-lg border border-coral/30 bg-coral/10 p-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t("existing.checkFailed")}</h2>
          <p className="mt-1 text-sm leading-6 text-ink/70">{error}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={onRetry}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("existing.retry")}
          </Button>
          <SecondaryButton onClick={onConfigureFromScratch}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("existing.configureFresh")}
          </SecondaryButton>
        </div>
      </section>
    );
  }

  if (!setup) return null;

  return (
    <section aria-labelledby="existing-setup-title">
      <h2 id="existing-setup-title" className="text-2xl font-semibold text-ink">
        {t("existing.title")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink/70">
        {t("existing.desc", { repository: `${setup.repository.owner}/${setup.repository.repo}` })}
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onConfigureFromScratch}
          className="rounded-lg border border-line bg-paper p-4 text-left transition hover:border-steel"
        >
          <RotateCcw className="size-5 text-steel" aria-hidden="true" />
          <div className="mt-3 font-semibold text-ink">{t("existing.freshTitle")}</div>
          <p className="mt-1 text-sm leading-6 text-ink/65">{t("existing.freshDesc")}</p>
        </button>

        <button
          type="button"
          onClick={onRetainCredentials}
          disabled={!setup.config}
          className="rounded-lg border border-moss/40 bg-mint p-4 text-left transition hover:border-moss disabled:cursor-not-allowed disabled:border-line disabled:bg-paper disabled:opacity-55"
        >
          <KeyRound className="size-5 text-moss" aria-hidden="true" />
          <div className="mt-3 font-semibold text-ink">{t("existing.retainTitle")}</div>
          <p className="mt-1 text-sm leading-6 text-ink/65">
            {setup.config ? t("existing.retainDesc") : t("existing.noDnsVariable")}
          </p>
        </button>
      </div>
    </section>
  );
}
