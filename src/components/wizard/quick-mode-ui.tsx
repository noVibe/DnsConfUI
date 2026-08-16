"use client";

import { CheckCircle2, Loader2, X } from "lucide-react";
import type { UseFormSetValue } from "react-hook-form";
import type { DnsConfConfig } from "@/domain/dnsconf-config";
import type { ProvisionResult } from "@/lib/github/provisioning";
import { useLocale } from "@/lib/i18n/context";
import { CredsGuide } from "./creds-guide";
import { ProfilesSection } from "./profiles-section";
import { ToggleSwitch } from "./toggle-switch";
import { ProvisionPanel } from "./provision-panel";

export function QuickModeUI({
  mode,
  setMode,
  profiles,
  providerLabel,
  providerValue,
  setValue,
  profileClientIdErrors,
  profileSecretErrors,
  profileDonorErrors,
  mixedProviderIndices,
  geoBlock,
  geoHideChecked,
  malwChecked,
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
  onStar
}: {
  mode: "quick" | "expert";
  setMode: (m: "quick" | "expert") => void;
  profiles: DnsConfConfig["profiles"];
  providerLabel: string | null;
  providerValue: string | null;
  setValue: UseFormSetValue<DnsConfConfig>;
  profileClientIdErrors?: Array<{ index: number; message: string }>;
  profileSecretErrors?: Array<{ index: number; message: string }>;
  profileDonorErrors?: Array<{ index: number; message: string }>;
  mixedProviderIndices: Set<number>;
  geoBlock: boolean;
  geoHideChecked: boolean;
  malwChecked: boolean;
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
}) {
  const { t } = useLocale();
  const isNextDNS = providerValue === "nextdns";
  const noToggles = !geoBlock && !blockAds && !disguisedTrackers && !nativeTracking;

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-5">
        <CredsGuide />
         <ProfilesSection
            profiles={profiles}
            setValue={setValue}
            profileClientIdErrors={profileClientIdErrors}
            profileSecretErrors={profileSecretErrors}
            profileDonorErrors={profileDonorErrors}
            mixedProviderIndices={mixedProviderIndices}
            simplified
            onValidChange={onProfilesValidChange}
          />

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

            <ToggleSwitch
              checked={blockAds}
              onChange={onBlockAdsChange}
              label={t('quick.blockAds')}
              tooltip={
                isNextDNS
                  ? t('quick.blockAdsNdTooltip')
                  : t('quick.blockAdsCfTooltip')
              }
            />

            {isNextDNS ? (
              <ToggleSwitch
                checked={disguisedTrackers}
                onChange={onDisguisedTrackersChange}
                label={t('quick.disguised')}
                tooltip={t('quick.disguisedTooltip')}
              />
            ) : null}

            {isNextDNS ? (
              <ToggleSwitch
                checked={nativeTracking}
                onChange={onNativeTrackingChange}
                label={t('quick.native')}
                tooltip={t('quick.nativeTooltip')}
              />
            ) : null}

            {noToggles && status === "idle" ? (
              <p className="text-sm leading-5 text-coral">Enable at least one feature.</p>
            ) : null}
          </section>
        ) : null}
      </div>

      <aside className="space-y-5">
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
        />
      </aside>
    </div>
  );
}
