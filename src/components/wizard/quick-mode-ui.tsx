"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Loader2, X } from "lucide-react";
import type { UseFormSetValue } from "react-hook-form";
import type { DnsConfConfig } from "@/domain/dnsconf-config";
import type { ProvisionResult } from "@/lib/github/provisioning";
import { useLocale } from "@/lib/i18n/context";
import { SecondaryButton } from "@/components/ui";
import { CredsGuide } from "./creds-guide";
import { ProfilesSection } from "./profiles-section";
import { ToggleSwitch } from "./toggle-switch";
import { ProvisionPanel } from "./provision-panel";

export function QuickModeUI({
  mode,
  setMode,
  profiles,
  providerLabel,
  setValue,
  profileClientIdErrors,
  profileSecretErrors,
  profileDonorErrors,
  mixedProviderIndices,
  geoBlock,
  geoHideChecked,
  malwChecked,
  customRedirects = [],
  blockAds,
  disguisedTrackers,
  nativeTracking,
  onGeoBlockChange,
  onGeoHideChange,
  onMalwChange,
  onBlockAdsChange,
  onDisguisedTrackersChange,
  onNativeTrackingChange,
  onProfilesValidChange,
  onProvision,
  status,
  message,
  disabled,
  quickSteps,
  result,
  starred,
  starring,
  onStar,
  retainCredentials = false,
  onConfigureFromScratch,
  onReturnToRetained
}: {
  mode: "quick" | "expert";
  setMode: (m: "quick" | "expert") => void;
  profiles: DnsConfConfig["profiles"];
  providerLabel: string | null;
  setValue: UseFormSetValue<DnsConfConfig>;
  profileClientIdErrors?: Array<{ index: number; message: string }>;
  profileSecretErrors?: Array<{ index: number; message: string }>;
  profileDonorErrors?: Array<{ index: number; message: string }>;
  mixedProviderIndices: Set<number>;
  geoBlock: boolean;
  geoHideChecked: boolean;
  malwChecked: boolean;
  customRedirects?: string[];
  blockAds: boolean;
  disguisedTrackers: boolean;
  nativeTracking: boolean;
  onGeoBlockChange: (v: boolean) => void;
  onGeoHideChange: (v: boolean) => void;
  onMalwChange: (v: boolean) => void;
  onBlockAdsChange: (v: boolean) => void;
  onDisguisedTrackersChange: (v: boolean) => void;
  onNativeTrackingChange: (v: boolean) => void;
  onProfilesValidChange: (v: boolean) => void;
  onProvision: () => void;
  status: "idle" | "running" | "done" | "error";
  message: string;
  disabled: boolean;
  quickSteps: Array<{ id: string; label: string; status: "pending" | "running" | "done" | "error" | "skipped" }>;
  result: ProvisionResult | null;
  starred: boolean;
  starring: boolean;
  onStar: () => Promise<void>;
  retainCredentials?: boolean;
  onConfigureFromScratch?: () => void;
  onReturnToRetained?: () => void;
}) {
  const { t } = useLocale();
  const hasNextDns = profiles.some((profile) => profile.provider === "nextdns");
  const noToggles = !geoBlock && !blockAds && !disguisedTrackers && !nativeTracking;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="min-w-0 space-y-5">
        {!retainCredentials ? <CredsGuide /> : null}
         <ProfilesSection
            profiles={profiles}
            setValue={setValue}
            profileClientIdErrors={profileClientIdErrors}
            profileSecretErrors={profileSecretErrors}
            profileDonorErrors={profileDonorErrors}
            mixedProviderIndices={mixedProviderIndices}
            simplified
            onValidChange={onProfilesValidChange}
            retainCredentials={retainCredentials}
          />

        {onReturnToRetained ? (
          <SecondaryButton type="button" onClick={onReturnToRetained} className="w-full sm:w-auto">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t('existing.returnToRetained')}
          </SecondaryButton>
        ) : null}

        {providerLabel ? (
          <section className="space-y-3 rounded-lg border border-line bg-paper p-4">
            <span className="text-sm font-medium text-ink">{t('quick.features')}</span>

            <ToggleSwitch
              checked={geoBlock}
              onChange={onGeoBlockChange}
              label={t('quick.bypass')}
              tooltip={t('quick.bypassTooltip')}
            >
              <div className={`flex items-center gap-2 ${geoBlock ? "" : "opacity-40"}`}>
                <label className={`flex items-center gap-1 text-xs ${geoBlock ? "cursor-pointer text-ink/70 hover:text-ink" : "text-ink/40"}`}>
                  <input
                    type="checkbox"
                    checked={geoHideChecked}
                    onChange={(e) => onGeoHideChange(e.target.checked)}
                    className="size-3 accent-moss"
                  />
                  <span>{t('quick.geohide')}</span>
                </label>
                <label className={`flex items-center gap-1 text-xs ${geoBlock ? "cursor-pointer text-ink/70 hover:text-ink" : "text-ink/40"}`}>
                  <input
                    type="checkbox"
                    checked={malwChecked}
                    onChange={(e) => onMalwChange(e.target.checked)}
                    className="size-3 accent-moss"
                  />
                  <span>{t('quick.malw')}</span>
                </label>
              </div>
            </ToggleSwitch>

            {retainCredentials && customRedirects.length > 0 ? (
              <div className={`space-y-1.5 rounded-lg border border-line/70 bg-white/50 px-3 py-2 ${geoBlock ? "" : "opacity-50"}`}>
                <p className="text-xs font-medium text-ink/60">{t('quick.customRedirects')}</p>
                {customRedirects.map((url, index) => (
                  <input
                    key={`${url}-${index}`}
                    type="url"
                    readOnly
                    value={url}
                    aria-label={t('quick.customRedirect', { n: index + 1 })}
                    className="h-8 w-full rounded-md border border-line bg-paper px-2 text-xs text-ink/70 outline-none"
                  />
                ))}
              </div>
            ) : null}

            {!retainCredentials || !hasNextDns ? (
              <ToggleSwitch
                checked={blockAds}
                onChange={onBlockAdsChange}
                label={t('quick.blockAds')}
                tooltip={hasNextDns ? t('quick.blockAdsNdTooltip') : t('quick.blockAdsCfTooltip')}
              />
            ) : null}

            {hasNextDns && !retainCredentials ? (
              <ToggleSwitch
                checked={disguisedTrackers}
                onChange={onDisguisedTrackersChange}
                label={t('quick.disguised')}
                tooltip={t('quick.disguisedTooltip')}
              />
            ) : null}

            {hasNextDns && !retainCredentials ? (
              <ToggleSwitch
                checked={nativeTracking}
                onChange={onNativeTrackingChange}
                label={t('quick.native')}
                tooltip={t('quick.nativeTooltip')}
              />
            ) : null}

            {!retainCredentials && noToggles && status === "idle" ? (
              <p className="text-sm leading-5 text-coral">{t('wizard.enableFeature')}</p>
            ) : null}
          </section>
        ) : null}

        {retainCredentials && hasNextDns ? (
          <section aria-labelledby="unavailable-nextdns-title" className="space-y-3 rounded-lg border border-steel/25 bg-steel/5 p-4">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 size-5 shrink-0 text-steel" aria-hidden="true" />
              <div>
                <h3 id="unavailable-nextdns-title" className="text-sm font-semibold text-ink">
                  {t('quick.unavailableTitle')}
                </h3>
                <p className="mt-1 text-sm leading-6 text-ink/65">{t('quick.unavailableDesc')}</p>
              </div>
            </div>
            <ul className="space-y-1.5 pl-8 text-sm text-ink/70">
              <li>{t('quick.blockAds')}</li>
              <li>{t('quick.disguised')}</li>
              <li>{t('quick.native')}</li>
            </ul>
            {onConfigureFromScratch ? (
              <SecondaryButton type="button" onClick={onConfigureFromScratch} className="ml-8 min-h-9 py-1.5">
                {t('quick.openFullSetup')}
                <ArrowRight className="size-4" aria-hidden="true" />
              </SecondaryButton>
            ) : null}
          </section>
        ) : null}
      </div>

      <aside className="min-w-0 space-y-5">
        {status !== "idle" ? (
          <section className="rounded-lg border border-line bg-paper p-4">
            <h3 className="text-sm font-semibold text-ink">{t('quick.progress')}</h3>
            <ul className="mt-3 space-y-2">
              {quickSteps.map(step => (
                <li key={step.id} className="flex items-center gap-2 text-sm">
                  {step.status === "running" ? (
                    <Loader2 className="size-4 animate-spin text-moss" aria-hidden="true" />
                  ) : step.status === "done" ? (
                    <CheckCircle2 className="size-4 text-moss" aria-hidden="true" />
                  ) : step.status === "error" ? (
                    <X className="size-4 text-coral" aria-hidden="true" />
                  ) : step.status === "skipped" ? (
                    <span className="size-4 rounded-full border-2 border-line" aria-hidden="true" />
                  ) : (
                    <span className="size-4 rounded-full border-2 border-line/40" aria-hidden="true" />
                  )}
                  <span className={
                    step.status === "running" ? "text-ink font-medium" :
                    step.status === "error" ? "text-coral" :
                    "text-ink/60"
                  }>
                    {step.label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <ProvisionPanel
          status={status}
          message={message}
          result={result}
          onProvision={onProvision}
          disabled={disabled}
          starred={starred}
          starring={starring}
          onStar={onStar}
          retainCredentials={retainCredentials}
        />
      </aside>
    </div>
  );
}
