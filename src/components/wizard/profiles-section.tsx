"use client";

import { CheckCircle2, ChevronDown, Loader2, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UseFormSetValue } from "react-hook-form";
import type { DnsConfConfig } from "@/domain/dnsconf-config";
import { DEFAULT_DNS_DONOR, DNS_DONORS, isDnsDonorPreset } from "@/domain/dns-donors";
import { validateCredentials } from "@/lib/nextdns/api";
import { useLocale } from "@/lib/i18n/context";
import { Field, inputClass } from "@/components/ui";
import { CLOUDFLARE_CLIENT_ID_LENGTH, NEXTDNS_CLIENT_ID_LENGTH } from "@/lib/constants";
import { translatedError } from "./utils";
import { ScriptBehaviour } from "./script-behaviour";
import { ToggleSwitch } from "./toggle-switch";
import { Tooltip } from "@/components/ui/tooltip";

export function ProfilesSection({
  profiles,
  setValue,
  profileClientIdErrors,
  profileSecretErrors,
  profileDonorErrors,
  mixedProviderIndices,
  simplified,
  onValidChange,
  retainCredentials = false
}: {
  profiles: DnsConfConfig["profiles"];
  setValue: UseFormSetValue<DnsConfConfig>;
  profileClientIdErrors?: Array<{ index: number; message: string }>;
  profileSecretErrors?: Array<{ index: number; message: string }>;
  profileDonorErrors?: Array<{ index: number; message: string }>;
  mixedProviderIndices?: Set<number>;
  simplified?: boolean;
  onValidChange?: (v: boolean) => void;
  retainCredentials?: boolean;
}) {
  const { t } = useLocale();
  const [selected, setSelected] = useState(0);
  const [credStatus, setCredStatus] = useState<Record<number, { status: "idle" | "validating" | "valid" | "invalid"; message?: string }>>({});
  const validateTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const validationVersions = useRef<Record<number, number>>({});
  useEffect(() => () => { Object.values(validateTimers.current).forEach(clearTimeout); }, []);

  useEffect(() => {
    const p = profiles[selected];
    const detected = p?.clientId?.length === CLOUDFLARE_CLIENT_ID_LENGTH ? "cloudflare" : p?.clientId?.length === NEXTDNS_CLIENT_ID_LENGTH ? "nextdns" : null;
    if (!detected || !p?.authSecret?.trim() || credStatus[selected]) return;
    const version = (validationVersions.current[selected] ?? 0) + 1;
    validationVersions.current[selected] = version;
    const timer = setTimeout(async () => {
      setCredStatus(prev => ({ ...prev, [selected]: { status: "validating" } }));
      const result = await validateCredentials(p.clientId, p.authSecret, detected);
      if (validationVersions.current[selected] !== version) return;
      setCredStatus(prev => ({
        ...prev,
        [selected]: result.valid
          ? { status: "valid" }
          : { status: "invalid", message: result.error }
      }));
    }, 1000);
    validateTimers.current[selected] = timer;
  }, [selected, simplified]);

  useEffect(() => {
    if (!onValidChange) return;
    const allValid = profiles.every((p, i) => {
      if (!p.clientId?.trim() || !p.authSecret?.trim()) return true;
      return credStatus[i]?.status === "valid";
    });
    onValidChange(allValid);
  }, [credStatus, profiles, onValidChange]);

  function update(index: number, field: "clientId" | "authSecret" | "provider" | "donorDns", value: string) {
    const next = profiles.map((p, i) =>
      i === index ? { ...p, [field]: value } : p
    ) as DnsConfConfig["profiles"];
    setValue("profiles", next, { shouldDirty: true, shouldValidate: true });

    if (field !== "clientId" && field !== "authSecret") return;

    const timer = validateTimers.current[index];
    if (timer) clearTimeout(timer);
    const version = (validationVersions.current[index] ?? 0) + 1;
    validationVersions.current[index] = version;
    setCredStatus(prev => {
      const cleared = { ...prev };
      delete cleared[index];
      return cleared;
    });

    const p = next[index];
    const len = p?.clientId?.length ?? 0;
    const detected = len === CLOUDFLARE_CLIENT_ID_LENGTH ? "cloudflare" : len === NEXTDNS_CLIENT_ID_LENGTH ? "nextdns" : null;
    if (!detected || !p?.authSecret?.trim()) return;

    validateTimers.current[index] = setTimeout(async () => {
      setCredStatus(prev => ({ ...prev, [index]: { status: "validating" } }));
      const result = await validateCredentials(p.clientId, p.authSecret, detected);
      if (validationVersions.current[index] !== version) return;
      setCredStatus(prev => ({
        ...prev,
        [index]: result.valid
          ? { status: "valid" }
          : { status: "invalid", message: result.error }
      }));
    }, 1000);
  }

  function remove(index: number) {
    const next = profiles.filter((_, i) => i !== index);
    setValue("profiles", next.length ? (next as DnsConfConfig["profiles"]) : [{ clientId: "", authSecret: "", provider: "", donorDns: DEFAULT_DNS_DONOR }], { shouldDirty: true, shouldValidate: true });
    if (selected >= next.length) {
      setSelected(Math.max(0, next.length - 1));
    }
  }

  function add() {
    setValue("profiles", [...profiles, { clientId: "", authSecret: "", provider: "", donorDns: DEFAULT_DNS_DONOR }] as DnsConfConfig["profiles"], { shouldDirty: true, shouldValidate: true });
    setSelected(profiles.length);
  }

  return (
    <section className="space-y-4 rounded-lg border border-line bg-paper p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{t('profiles.title')}</span>
          <select
            className="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink"
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
            aria-label={t('profiles.select')}
          >
            {profiles.map((_, i) => (
              <option key={i} value={i}>Profile {i + 1}</option>
            ))}
          </select>
        </div>
        {!retainCredentials ? (
          <button
            type="button"
            onClick={add}
            className="inline-flex items-center gap-0.5 text-xs text-steel transition hover:text-ink"
          >
            <Plus className="size-3.5" />
            {t('profiles.add')}
          </button>
        ) : null}
      </div>

      {profiles[selected] ? (
        <div className="space-y-3 rounded-md border border-line bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-ink/60">Profile {selected + 1}</div>
              {retainCredentials && profiles[selected].provider ? (
                <div className="mt-1 text-sm font-medium text-moss">
                  {t('profiles.dns', { provider: t(profiles[selected].provider === "cloudflare" ? 'profiles.providerCloudflare' : 'profiles.providerNextDNS') })}
                </div>
              ) : null}
            </div>
            {!retainCredentials ? (
              <button
                type="button"
                onClick={() => remove(selected)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-ink/40 transition hover:border-coral hover:text-coral"
                aria-label={t('profiles.remove')}
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          {retainCredentials ? (
            <p className="text-sm leading-6 text-ink/65">{t('profiles.credentialsRetained')}</p>
          ) : (
            <>
              <Field label={<span>{t('profiles.clientId')} <span className="text-coral">*</span></span>} error={translatedError(profileClientIdErrors?.find(e => e.index === selected)?.message, t)}>
                <input className={inputClass} autoComplete="off" value={profiles[selected].clientId} onChange={(e) => update(selected, "clientId", e.target.value)} />
              </Field>
              <Field label={<span>{t('profiles.authSecret')} <span className="text-coral">*</span></span>} error={translatedError(profileSecretErrors?.find(e => e.index === selected)?.message, t)}>
                <input className={inputClass} type="password" autoComplete="off" value={profiles[selected].authSecret} onChange={(e) => update(selected, "authSecret", e.target.value)} />
              </Field>
            </>
          )}
          {!retainCredentials && simplified && credStatus[selected] ? (
            <div className="flex items-start gap-2 text-sm">
              {credStatus[selected].status === "validating" ? (
                <Loader2 className="mt-0.5 size-4 animate-spin text-moss shrink-0" aria-hidden="true" />
              ) : credStatus[selected].status === "valid" ? (
                <CheckCircle2 className="mt-0.5 size-4 text-moss shrink-0" aria-hidden="true" />
              ) : credStatus[selected].status === "invalid" ? (
                <X className="mt-0.5 size-4 text-coral shrink-0" aria-hidden="true" />
              ) : null}
              <span className={
                credStatus[selected].status === "invalid" ? "text-coral" : "text-moss"
              }>
                {credStatus[selected].status === "validating" ? t('profiles.checking') :
                 credStatus[selected].status === "valid" ? t('profiles.verified') :
                 credStatus[selected].status === "invalid" ? credStatus[selected].message ?? t('profiles.invalid') :
                 null}
              </span>
            </div>
          ) : null}
          {!retainCredentials && profiles[selected].provider ? (
            <div>
              {simplified ? (
                <div className="text-sm font-medium text-moss">
                  {t('profiles.dns', { provider: t(profiles[selected].provider === "cloudflare" ? 'profiles.providerCloudflare' : 'profiles.providerNextDNS') })}
                </div>
              ) : (
                <>
                  <div className="text-sm text-moss">{t('profiles.dns', { provider: t(profiles[selected].provider === "cloudflare" ? 'profiles.providerCloudflare' : 'profiles.providerNextDNS') })}</div>
                  <ScriptBehaviour provider={profiles[selected].provider as "cloudflare" | "nextdns"} />
                </>
              )}
            </div>
          ) : null}
          {!retainCredentials && simplified && mixedProviderIndices?.has(selected) ? (
            <div className="mt-2 rounded-md border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral">
              {t('wizard.mixedProvider')}
            </div>
          ) : null}
          {simplified ? (
            <ToggleSwitch
              checked={Boolean(profiles[selected].donorDns)}
              onChange={(checked) => update(selected, "donorDns", checked ? DEFAULT_DNS_DONOR : "")}
              label={t('profiles.donor')}
              tooltip={t('profiles.donorTooltip')}
            >
              {profiles[selected].donorDns ? (
                <select
                  className="h-5 rounded-md border border-line bg-white px-2 text-xs text-ink outline-none focus:border-steel focus:ring-2 focus:ring-steel/20"
                  value={profiles[selected].donorDns}
                  onChange={(e) => update(selected, "donorDns", e.target.value)}
                  aria-label={t('profiles.donor')}
                >
                  {!isDnsDonorPreset(profiles[selected].donorDns) ? (
                    <option value={profiles[selected].donorDns}>
                      {t('profiles.donorCustom')}: {profiles[selected].donorDns}
                    </option>
                  ) : null}
                  {DNS_DONORS.map((donor) => (
                    <option key={donor.value} value={donor.value}>{donor.label}</option>
                  ))}
                </select>
              ) : null}
            </ToggleSwitch>
          ) : (
            <Field
              label={(
                <span className="inline-flex items-center gap-1.5">
                  DONOR_DNS
                  <Tooltip text={t('profiles.donorTooltip')} />
                </span>
              )}
              error={profileDonorErrors?.find(e => e.index === selected) ? t('profiles.donorInvalid') : undefined}
            >
              <input
                className={inputClass}
                autoComplete="off"
                value={profiles[selected].donorDns}
                onChange={(e) => update(selected, "donorDns", e.target.value)}
                placeholder={t('profiles.donorPlaceholder')}
              />
            </Field>
          )}
        </div>
      ) : null}
      {!simplified ? (
        <p className="text-sm leading-6 text-ink/70">
          {t('profiles.hint')}
        </p>
      ) : null}
    </section>
  );
}
