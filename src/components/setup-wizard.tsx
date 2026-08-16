"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  buildDnsConfPayload,
  defaultDnsConfConfig,
  dnsConfConfigSchema,
  dnsConfWorkflow,
  type DnsConfConfig
} from "@/domain/dnsconf-config";
import { GEOHIDE_HOSTS_LIST, MALW_HOSTS_LIST, OISD_SMALL_BLOCK_SUBDOMAINS, OISD_SMALL_BLOCK_DOMAINS } from "@/domain/toggles";
import { configureNextDNSProfile, validateCredentials } from "@/lib/nextdns/api";
import { createGitHubRequest, provisionDnsConfRepository, starRepository, type ProvisionResult } from "@/lib/github/provisioning";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "./auth-provider";
import { CLOUDFLARE_CLIENT_ID_LENGTH, NEXTDNS_CLIENT_ID_LENGTH } from "@/lib/constants";
import { ModeTabs } from "./wizard/mode-tabs";
import { CredsGuide } from "./wizard/creds-guide";
import { SourcesSection } from "./wizard/sources-section";
import { ProfilesSection } from "./wizard/profiles-section";
import { ReviewPanel } from "./wizard/review-panel";
import { ProvisionPanel } from "./wizard/provision-panel";
import { QuickModeUI } from "./wizard/quick-mode-ui";
import { extractProfileErrors, fieldError, normalizeValues } from "./wizard/utils";

export function SetupWizard() {
  const { token } = useAuth();
  const { t } = useLocale();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [starred, setStarred] = useState(false);
  const [starring, setStarring] = useState(false);
  const [mode, setMode] = useState<"quick" | "expert">("quick");
  const [geoBlock, setGeoBlock] = useState(true);
  const [geoHideChecked, setGeoHideChecked] = useState(true);
  const [malwChecked, setMalwChecked] = useState(true);
  const [blockAds, setBlockAds] = useState(true);
  const [disguisedTrackers, setDisguisedTrackers] = useState(true);
  const [nativeTracking, setNativeTracking] = useState(true);

  const handleGeoHideChange = useCallback((checked: boolean) => {
    setGeoHideChecked(checked);
    if (!checked && !malwChecked) {
      setGeoBlock(false);
    } else if (checked && !geoBlock) {
      setGeoBlock(true);
    }
  }, [geoBlock, malwChecked]);

  const handleMalwChange = useCallback((checked: boolean) => {
    setMalwChecked(checked);
    if (!checked && !geoHideChecked) {
      setGeoBlock(false);
    } else if (checked && !geoBlock) {
      setGeoBlock(true);
    }
  }, [geoBlock, geoHideChecked]);

  const [quickSteps, setQuickSteps] = useState<{ id: string; label: string; status: "pending" | "running" | "done" | "error" | "skipped" }[]>([]);
  const [allProfilesValid, setAllProfilesValid] = useState(false);
  const form = useForm<DnsConfConfig>({ defaultValues: defaultDnsConfConfig, mode: "onChange" });
  const values = form.watch();
  const normalizedValues = normalizeValues(values);
  const parsed = dnsConfConfigSchema.safeParse(normalizedValues);
  const payload = useMemo(() => (parsed.success ? buildDnsConfPayload(parsed.data) : null), [parsed]);

  const hasToggles = geoBlock || blockAds || disguisedTrackers || nativeTracking;

  const mixedProviderIndices = useMemo(() => {
    const profiles = values.profiles ?? [];
    if (profiles.length < 2) return new Set<number>();
    const refProvider = profiles[0]?.provider;
    if (!refProvider) return new Set<number>();
    const indices = new Set<number>();
    for (let i = 1; i < profiles.length; i++) {
      if (profiles[i]?.provider && profiles[i]?.provider !== refProvider) {
        indices.add(i);
      }
    }
    return indices;
  }, [values.profiles]);

  const canQuickProvision = useMemo(() => {
    const profiles = values.profiles ?? [];
    if (profiles.length === 0) return false;
    if (mixedProviderIndices.size > 0) return false;
    const allFilled = profiles.every(p => p.clientId?.trim() && p.authSecret?.trim());
    return allFilled && hasToggles && !!profiles[0]?.provider && allProfilesValid && parsed.success;
  }, [values.profiles, hasToggles, mixedProviderIndices, allProfilesValid, parsed.success]);

  async function quickProvision() {
    if (!token) return;
    const profiles = values.profiles ?? [];
    const provider = profiles[0]?.provider;

    if (!provider) {
      setStatus("error");
      setMessage(t('wizard.noProvider'));
      return;
    }

    if (profiles.length === 0 || !profiles.every(p => p.clientId && p.authSecret)) {
      setStatus("error");
      setMessage(t('wizard.fillAll'));
      return;
    }

    if (!geoBlock && !blockAds && !disguisedTrackers && !nativeTracking) {
      setStatus("error");
      setMessage(t('wizard.enableFeature'));
      return;
    }

    if (!profiles.every(p => p.provider === provider)) {
      setStatus("error");
      setMessage(t('wizard.mixedProvider'));
      return;
    }

    const steps: { id: string; label: string; status: "pending" | "running" | "done" | "error" | "skipped" }[] = [];

    if (provider === "nextdns") {
      if (blockAds || disguisedTrackers) {
        steps.push({ id: "blocklists", label: "Block ads & disguised trackers", status: "pending" });
      }
      if (nativeTracking) {
        steps.push({ id: "natives", label: "Native tracking protection", status: "pending" });
      }
    }

    if (geoBlock) {
      steps.push({ id: "hosts", label: "Geo-blocking hosts", status: "pending" });
    }

    steps.push({ id: "fork", label: t('wizard.fork'), status: "pending" });
    steps.push({ id: "secrets", label: t('wizard.secrets'), status: "pending" });
    steps.push({ id: "dispatch", label: t('wizard.run'), status: "pending" });

    setQuickSteps(steps);
    setStatus("running");
    setMessage("");

    try {
      if (provider === "nextdns") {
        if (blockAds || disguisedTrackers) {
          setQuickSteps(prev => prev.map(s => s.id === "blocklists" ? { ...s, status: "running" } : s));
          for (const profile of profiles) {
            const result = await configureNextDNSProfile(
              profile.clientId, profile.authSecret,
              blockAds, false, disguisedTrackers
            );
            if (!result.success) {
              throw new Error(`Profile ${profile.clientId}: ${result.error}`);
            }
          }
          setQuickSteps(prev => prev.map(s => s.id === "blocklists" ? { ...s, status: "done" } : s));
        }

        if (nativeTracking) {
          setQuickSteps(prev => prev.map(s => s.id === "natives" ? { ...s, status: "running" } : s));
          for (const profile of profiles) {
            const result = await configureNextDNSProfile(
              profile.clientId, profile.authSecret,
              false, true, false
            );
            if (!result.success) {
              throw new Error(`Profile ${profile.clientId}: ${result.error}`);
            }
          }
          setQuickSteps(prev => prev.map(s => s.id === "natives" ? { ...s, status: "done" } : s));
        }
      }

      const blockUrls: string[] = [];
      const redirectUrls: string[] = [];
      if (geoBlock && geoHideChecked) {
        redirectUrls.push(GEOHIDE_HOSTS_LIST);
      }
      if (geoBlock && malwChecked) {
        redirectUrls.push(MALW_HOSTS_LIST);
      }
      if (blockAds && provider === "cloudflare") {
        [OISD_SMALL_BLOCK_SUBDOMAINS, OISD_SMALL_BLOCK_DOMAINS].forEach(url => { if (!blockUrls.includes(url)) blockUrls.push(url); });
      }

      if (redirectUrls.length > 0) {
        setQuickSteps(prev => prev.map(s => s.id === "hosts" ? { ...s, status: "done" } : s));
      }

      const config: DnsConfConfig = {
        profiles: profiles as DnsConfConfig["profiles"],
        blocklists: blockUrls,
        redirects: redirectUrls,
        redirectExclusions: []
      };

      setQuickSteps(prev => prev.map(s => s.id === "fork" ? { ...s, status: "running" } : s));

      const provisionResult = await provisionDnsConfRepository({
        ...dnsConfWorkflow,
        payload: buildDnsConfPayload(config),
        request: createGitHubRequest(token),
        profileCount: config.profiles.length,
        onStep: async (step) => {
          if (step === "fork") {
            setQuickSteps(prev => prev.map(s => s.id === "fork" ? { ...s, status: "done" } : s));
            setQuickSteps(prev => prev.map(s => s.id === "secrets" ? { ...s, status: "running" } : s));
          } else if (step === "secrets") {
            setQuickSteps(prev => prev.map(s => s.id === "secrets" ? { ...s, status: "done" } : s));
            setQuickSteps(prev => prev.map(s => s.id === "dispatch" ? { ...s, status: "running" } : s));
          } else if (step === "dispatch") {
            setQuickSteps(prev => prev.map(s => s.id === "dispatch" ? { ...s, status: "done" } : s));
          }
        }
      });

      setResult(provisionResult);
      setStatus("done");
    } catch (error) {
      setQuickSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "error" as const } : s));
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t('wizard.provisionFailed'));
    }
  }

  const clientIdsJson = JSON.stringify((values.profiles ?? []).map(p => p.clientId));
  const prevClientIdsJson = useRef(clientIdsJson);

  useEffect(() => {
    const prev = prevClientIdsJson.current;
    prevClientIdsJson.current = clientIdsJson;

    if (clientIdsJson === prev) return;
    const current = values.profiles ?? [];
    const prevIds: string[] = JSON.parse(prev);
    const next = [...current];

    let changed = false;
    for (let i = 0; i < next.length; i++) {
      const prevId = prevIds[i] ?? "";
      const curId = next[i]?.clientId ?? "";
      if (curId === prevId) continue;

      const len = curId.length;
      const detected = len === CLOUDFLARE_CLIENT_ID_LENGTH ? "cloudflare" : len === NEXTDNS_CLIENT_ID_LENGTH ? "nextdns" : null;
      next[i] = { ...next[i], provider: detected ?? "" };
      changed = true;
    }

    if (changed) {
      form.setValue("profiles", next, { shouldDirty: true });
    }
  }, [clientIdsJson, form.setValue]);

  async function provision() {
    const parsedConfig = dnsConfConfigSchema.safeParse(normalizeValues(values));

    if (!parsedConfig.success || !token) {
      setStatus("error");
      setMessage(t('wizard.configIncomplete'));
      return;
    }

    setStatus("running");
    setMessage("");

    try {
      const provisionResult = await provisionDnsConfRepository({
        ...dnsConfWorkflow,
        payload: buildDnsConfPayload(parsedConfig.data),
        request: createGitHubRequest(token),
        profileCount: parsedConfig.data.profiles.length
      });
      setResult(provisionResult);
      setStatus("done");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t('wizard.ghProvisionFailed'));
    }
  }

  async function handleStar() {
    if (!token || !result) return;
    setStarring(true);
    try {
      await Promise.all([
        starRepository(createGitHubRequest(token), dnsConfWorkflow.sourceOwner, dnsConfWorkflow.sourceRepo),
        starRepository(createGitHubRequest(token), "noVibe", "DnsConfUI")
      ]);
      setStarred(true);
    } catch {
      setStarred(false);
    } finally {
      setStarring(false);
    }
  }

  const providerLabel = (values.profiles?.[0]?.provider ?? null) === "nextdns" ? t('profiles.providerNextDNS')
    : (values.profiles?.[0]?.provider ?? null) === "cloudflare" ? t('profiles.providerCloudflare')
    : null;

  return (
    <section aria-labelledby="setup-title">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="setup-title" className="text-2xl font-semibold text-ink">
          {t('wizard.setup')}
        </h2>
        <ModeTabs mode={mode} setMode={setMode} />
      </div>

      {mode === "expert" ? (
        <div className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5">
            <CredsGuide />
            <SourcesSection
              blocklists={values.blocklists}
              redirects={values.redirects}
              redirectExclusions={values.redirectExclusions}
              setValue={form.setValue}
              blocklistsError={fieldError(parsed, "blocklists")}
              redirectsError={fieldError(parsed, "redirects")}
              redirectExclusionsError={fieldError(parsed, "redirectExclusions")}
            />
            <ProfilesSection
              profiles={values.profiles ?? []}
              setValue={form.setValue}
              profileClientIdErrors={extractProfileErrors(parsed, "clientId")}
              profileSecretErrors={extractProfileErrors(parsed, "authSecret")}
              profileDonorErrors={extractProfileErrors(parsed, "donorDns")}
              onValidChange={setAllProfilesValid}
            />
          </div>

          <aside className="space-y-5">
            <ReviewPanel payload={payload} valid={parsed.success} />
            <ProvisionPanel
              status={status}
              message={message}
              result={result}
              onProvision={provision}
              disabled={!parsed.success || status === "running" || !allProfilesValid}
              starred={starred}
              starring={starring}
              onStar={handleStar}
            />
          </aside>
        </div>
      ) : (
        <div className="mt-6">
          <QuickModeUI
            mode={mode}
            setMode={setMode}
            profiles={values.profiles ?? []}
            providerLabel={providerLabel}
            providerValue={values.profiles?.[0]?.provider ?? null}
            setValue={form.setValue}
            profileClientIdErrors={extractProfileErrors(parsed, "clientId")}
            profileSecretErrors={extractProfileErrors(parsed, "authSecret")}
            profileDonorErrors={extractProfileErrors(parsed, "donorDns")}
            mixedProviderIndices={mixedProviderIndices}
            geoBlock={geoBlock}
            geoHideChecked={geoHideChecked}
            malwChecked={malwChecked}
            blockAds={blockAds}
            disguisedTrackers={disguisedTrackers}
            nativeTracking={nativeTracking}
            onGeoBlockChange={setGeoBlock}
            onGeoHideChange={handleGeoHideChange}
            onMalwChange={handleMalwChange}
            onBlockAdsChange={setBlockAds}
            onDisguisedTrackersChange={setDisguisedTrackers}
            onNativeTrackingChange={setNativeTracking}
            onProfilesValidChange={setAllProfilesValid}
            quickSteps={quickSteps}
            onProvision={quickProvision}
            status={status}
            message={message}
            disabled={!canQuickProvision || status === "running"}
            result={result}
            starred={starred}
            starring={starring}
            onStar={handleStar}
          />
        </div>
      )}
    </section>
  );
}

export { parseExcludeDomains } from "./wizard/utils";
