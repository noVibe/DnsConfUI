"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  buildDnsConfPayload,
  defaultDnsConfConfig,
  dnsConfConfigSchema,
  dnsConfWorkflow,
  retainedCredentialsConfigSchema,
  type DnsConfConfig
} from "@/domain/dnsconf-config";
import { GEOHIDE_HOSTS_LIST, MALW_HOSTS_LIST, OISD_SMALL_BLOCK_SUBDOMAINS, OISD_SMALL_BLOCK_DOMAINS } from "@/domain/toggles";
import { configureNextDNSProfile, validateCredentials } from "@/lib/nextdns/api";
import {
  createGitHubRequest,
  loadExistingDnsConfSetup,
  provisionDnsConfRepository,
  starRepository,
  type ExistingDnsConfSetup,
  type ProvisionResult
} from "@/lib/github/provisioning";
import { useLocale } from "@/lib/i18n/context";
import { SecondaryButton } from "@/components/ui";
import { useAuth } from "./auth-provider";
import { CLOUDFLARE_CLIENT_ID_LENGTH, NEXTDNS_CLIENT_ID_LENGTH } from "@/lib/constants";
import { ModeTabs } from "./wizard/mode-tabs";
import { CredsGuide } from "./wizard/creds-guide";
import { SourcesSection } from "./wizard/sources-section";
import { ProfilesSection } from "./wizard/profiles-section";
import { ReviewPanel } from "./wizard/review-panel";
import { ProvisionPanel } from "./wizard/provision-panel";
import { QuickModeUI } from "./wizard/quick-mode-ui";
import { ExistingSetupChoice } from "./wizard/existing-setup-choice";
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
  const [setupPath, setSetupPath] = useState<"checking" | "choice" | "fresh" | "retained">("checking");
  const [existingSetup, setExistingSetup] = useState<ExistingDnsConfSetup | null>(null);
  const [setupCheckError, setSetupCheckError] = useState("");
  const [setupCheckVersion, setSetupCheckVersion] = useState(0);
  const [canReturnToRetainedSetup, setCanReturnToRetainedSetup] = useState(false);
  const retainCredentials = setupPath === "retained";
  const retainedCustomRedirects = retainCredentials
    ? existingSetup?.config?.redirects.filter(
      (url) => url !== GEOHIDE_HOSTS_LIST && url !== MALW_HOSTS_LIST
    ) ?? []
    : [];

  const handleGeoHideChange = useCallback((checked: boolean) => {
    setGeoHideChecked(checked);
    if (!checked && !malwChecked && retainedCustomRedirects.length === 0) {
      setGeoBlock(false);
    } else if (checked && !geoBlock) {
      setGeoBlock(true);
    }
  }, [geoBlock, malwChecked, retainedCustomRedirects.length]);

  const handleMalwChange = useCallback((checked: boolean) => {
    setMalwChecked(checked);
    if (!checked && !geoHideChecked && retainedCustomRedirects.length === 0) {
      setGeoBlock(false);
    } else if (checked && !geoBlock) {
      setGeoBlock(true);
    }
  }, [geoBlock, geoHideChecked, retainedCustomRedirects.length]);

  const [quickSteps, setQuickSteps] = useState<{ id: string; label: string; status: "pending" | "running" | "done" | "error" | "skipped" }[]>([]);
  const [allProfilesValid, setAllProfilesValid] = useState(false);
  const form = useForm<DnsConfConfig>({ defaultValues: defaultDnsConfConfig, mode: "onChange" });
  const values = form.watch();
  const normalizedValues = normalizeValues(values);
  const parsed = retainCredentials
    ? retainedCredentialsConfigSchema.safeParse(normalizedValues)
    : dnsConfConfigSchema.safeParse(normalizedValues);
  const payload = parsed.success
    ? buildDnsConfPayload(parsed.data as DnsConfConfig, { retainCredentials })
    : null;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setSetupPath("checking");
    setSetupCheckError("");

    loadExistingDnsConfSetup(createGitHubRequest(token), dnsConfWorkflow.sourceOwner, dnsConfWorkflow.sourceRepo)
      .then((setup) => {
        if (cancelled) return;
        setExistingSetup(setup);
        setSetupPath(setup ? "choice" : "fresh");
      })
      .catch((error) => {
        if (cancelled) return;
        setExistingSetup(null);
        setSetupCheckError(error instanceof Error ? error.message : t("wizard.ghProvisionFailed"));
      });

    return () => {
      cancelled = true;
    };
  }, [token, setupCheckVersion]);

  function configureFromScratch() {
    setCanReturnToRetainedSetup(false);
    initializeFullSetup();
  }

  function configureFromRetainedSetup() {
    setCanReturnToRetainedSetup(true);
    initializeFullSetup();
  }

  function initializeFullSetup() {
    form.reset(defaultDnsConfConfig);
    setMode("quick");
    setGeoBlock(true);
    setGeoHideChecked(true);
    setMalwChecked(true);
    setBlockAds(true);
    setDisguisedTrackers(true);
    setNativeTracking(true);
    setAllProfilesValid(false);
    resetProvisionState();
    setSetupPath("fresh");
  }

  function configureWithRetainedCredentials() {
    const config = existingSetup?.config;
    if (!config) return;

    const hasGeoHide = config.redirects.includes(GEOHIDE_HOSTS_LIST);
    const hasMalw = config.redirects.includes(MALW_HOSTS_LIST);
    const hasNextDns = config.profiles.some((profile) => profile.provider === "nextdns");
    const hasCloudflareBlocklist = [OISD_SMALL_BLOCK_SUBDOMAINS, OISD_SMALL_BLOCK_DOMAINS]
      .some((url) => config.blocklists.includes(url));

    form.reset(config);
    setMode("quick");
    setGeoHideChecked(hasGeoHide);
    setMalwChecked(hasMalw);
    setGeoBlock(config.redirects.length > 0);
    setBlockAds(!hasNextDns && hasCloudflareBlocklist);
    setDisguisedTrackers(false);
    setNativeTracking(false);
    setAllProfilesValid(true);
    setCanReturnToRetainedSetup(false);
    resetProvisionState();
    setSetupPath("retained");
  }

  function resetProvisionState() {
    setStatus("idle");
    setMessage("");
    setResult(null);
    setQuickSteps([]);
  }

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
    if (!retainCredentials && mixedProviderIndices.size > 0) return false;
    const allFilled = retainCredentials || profiles.every(p => p.clientId?.trim() && p.authSecret?.trim());
    const featuresReady = retainCredentials || hasToggles;
    const credentialsReady = retainCredentials || allProfilesValid;
    return allFilled && featuresReady && profiles.every((profile) => Boolean(profile.provider)) && credentialsReady && parsed.success;
  }, [values.profiles, hasToggles, mixedProviderIndices, allProfilesValid, parsed.success, retainCredentials]);

  async function quickProvision() {
    if (!token) return;
    const profiles = values.profiles ?? [];
    const provider = profiles[0]?.provider;

    if (!provider) {
      setStatus("error");
      setMessage(t('wizard.noProvider'));
      return;
    }

    if (!retainCredentials && (profiles.length === 0 || !profiles.every(p => p.clientId && p.authSecret))) {
      setStatus("error");
      setMessage(t('wizard.fillAll'));
      return;
    }

    if (!retainCredentials && !geoBlock && !blockAds && !disguisedTrackers && !nativeTracking) {
      setStatus("error");
      setMessage(t('wizard.enableFeature'));
      return;
    }

    if (!retainCredentials && !profiles.every(p => p.provider === provider)) {
      setStatus("error");
      setMessage(t('wizard.mixedProvider'));
      return;
    }

    const steps: { id: string; label: string; status: "pending" | "running" | "done" | "error" | "skipped" }[] = [];

    if (!retainCredentials && provider === "nextdns") {
      if (blockAds || disguisedTrackers) {
        steps.push({ id: "blocklists", label: t('quick.blocklistsStep'), status: "pending" });
      }
      if (nativeTracking) {
        steps.push({ id: "natives", label: t('quick.nativeStep'), status: "pending" });
      }
    }

    if (geoBlock) {
      steps.push({ id: "hosts", label: t('quick.hostsStep'), status: "pending" });
    }

    steps.push({ id: "fork", label: t(retainCredentials ? 'wizard.syncFork' : 'wizard.fork'), status: "pending" });
    steps.push({ id: "secrets", label: t(retainCredentials ? 'wizard.variables' : 'wizard.secrets'), status: "pending" });
    steps.push({ id: "dispatch", label: t('wizard.run'), status: "pending" });
    steps.push({ id: "workflow", label: t('wizard.workflow'), status: "pending" });

    setQuickSteps(steps);
    setStatus("running");
    setMessage("");

    try {
      if (!retainCredentials && provider === "nextdns") {
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

      const config = buildQuickDnsConfConfig({
        profiles: profiles as DnsConfConfig["profiles"],
        existingBlocklists: values.blocklists ?? [],
        existingRedirects: values.redirects ?? [],
        existingRedirectExclusions: values.redirectExclusions ?? [],
        geoBlock,
        geoHideChecked,
        malwChecked,
        blockAds,
        retainCredentials
      });

      if (config.redirects.length > 0) {
        setQuickSteps(prev => prev.map(s => s.id === "hosts" ? { ...s, status: "done" } : s));
      }

      setQuickSteps(prev => prev.map(s => s.id === "fork" ? { ...s, status: "running" } : s));

      const provisionResult = await provisionDnsConfRepository({
        ...dnsConfWorkflow,
        payload: buildDnsConfPayload(config, { retainCredentials }),
        request: createGitHubRequest(token),
        profileCount: config.profiles.length,
        retainCredentials,
        variableEnvironment: existingSetup?.variableEnvironment,
        onStep: async (step) => {
          if (step === "fork") {
            setQuickSteps(prev => prev.map(s => s.id === "fork" ? { ...s, status: "done" } : s));
            setQuickSteps(prev => prev.map(s => s.id === "secrets" ? { ...s, status: "running" } : s));
          } else if (step === "secrets") {
            setQuickSteps(prev => prev.map(s => s.id === "secrets" ? { ...s, status: "done" } : s));
            setQuickSteps(prev => prev.map(s => s.id === "dispatch" ? { ...s, status: "running" } : s));
          } else if (step === "dispatch") {
            setQuickSteps(prev => prev.map(s => s.id === "dispatch" ? { ...s, status: "done" } : s));
            setQuickSteps(prev => prev.map(s => s.id === "workflow" ? { ...s, status: "running" } : s));
          } else if (step === "workflow") {
            setQuickSteps(prev => prev.map(s => s.id === "workflow" ? { ...s, status: "done" } : s));
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
    if (retainCredentials) return;
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
  }, [clientIdsJson, form.setValue, retainCredentials]);

  async function provision() {
    const parsedConfig = retainCredentials
      ? retainedCredentialsConfigSchema.safeParse(normalizeValues(values))
      : dnsConfConfigSchema.safeParse(normalizeValues(values));

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
        payload: buildDnsConfPayload(parsedConfig.data as DnsConfConfig, { retainCredentials }),
        request: createGitHubRequest(token),
        profileCount: parsedConfig.data.profiles.length,
        retainCredentials,
        variableEnvironment: existingSetup?.variableEnvironment
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

  if (setupPath === "checking" || setupPath === "choice") {
    return (
      <ExistingSetupChoice
        loading={setupPath === "checking" && !setupCheckError}
        error={setupCheckError}
        setup={existingSetup}
        onRetry={() => setSetupCheckVersion((version) => version + 1)}
        onConfigureFromScratch={configureFromScratch}
        onRetainCredentials={configureWithRetainedCredentials}
      />
    );
  }

  return (
    <section aria-labelledby="setup-title">
      <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="setup-title" className="text-2xl font-semibold text-ink">
          {t('wizard.setup')}
        </h2>
        <ModeTabs mode={mode} setMode={setMode} />
      </div>

      {mode === "expert" ? (
        <div className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5">
            {!retainCredentials ? <CredsGuide /> : null}
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
              retainCredentials={retainCredentials}
            />
            {canReturnToRetainedSetup ? (
              <SecondaryButton
                type="button"
                onClick={configureWithRetainedCredentials}
                className="w-full sm:w-auto"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t('existing.returnToRetained')}
              </SecondaryButton>
            ) : null}
          </div>

          <aside className="space-y-5">
            <ReviewPanel payload={payload} valid={parsed.success} retainCredentials={retainCredentials} />
            <ProvisionPanel
              status={status}
              message={message}
              result={result}
              onProvision={provision}
              disabled={!parsed.success || status === "running" || (!retainCredentials && !allProfilesValid)}
              starred={starred}
              starring={starring}
              onStar={handleStar}
              retainCredentials={retainCredentials}
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
            setValue={form.setValue}
            profileClientIdErrors={extractProfileErrors(parsed, "clientId")}
            profileSecretErrors={extractProfileErrors(parsed, "authSecret")}
            profileDonorErrors={extractProfileErrors(parsed, "donorDns")}
            mixedProviderIndices={mixedProviderIndices}
            geoBlock={geoBlock}
            geoHideChecked={geoHideChecked}
            malwChecked={malwChecked}
            customRedirects={retainedCustomRedirects}
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
            retainCredentials={retainCredentials}
            onConfigureFromScratch={configureFromRetainedSetup}
            onReturnToRetained={canReturnToRetainedSetup ? configureWithRetainedCredentials : undefined}
          />
        </div>
      )}
    </section>
  );
}

export { parseExcludeDomains } from "./wizard/utils";

export function buildQuickDnsConfConfig({
  profiles,
  existingBlocklists,
  existingRedirects,
  existingRedirectExclusions,
  geoBlock,
  geoHideChecked,
  malwChecked,
  blockAds,
  retainCredentials
}: {
  profiles: DnsConfConfig["profiles"];
  existingBlocklists: string[];
  existingRedirects: string[];
  existingRedirectExclusions: string[];
  geoBlock: boolean;
  geoHideChecked: boolean;
  malwChecked: boolean;
  blockAds: boolean;
  retainCredentials: boolean;
}): DnsConfConfig {
  const cloudflareBlocklists = [OISD_SMALL_BLOCK_SUBDOMAINS, OISD_SMALL_BLOCK_DOMAINS];
  const canEditBlockAds = !retainCredentials || profiles.every((profile) => profile.provider === "cloudflare");
  const blocklists = retainCredentials
    ? existingBlocklists.filter((url) => !canEditBlockAds || !cloudflareBlocklists.includes(url))
    : [];
  const redirects = retainCredentials && geoBlock
    ? existingRedirects.filter((url) => url !== GEOHIDE_HOSTS_LIST && url !== MALW_HOSTS_LIST)
    : [];

  if (geoBlock && geoHideChecked) redirects.push(GEOHIDE_HOSTS_LIST);
  if (geoBlock && malwChecked) redirects.push(MALW_HOSTS_LIST);
  if (blockAds && profiles.some((profile) => profile.provider === "cloudflare")) {
    cloudflareBlocklists.forEach((url) => {
      if (!blocklists.includes(url)) blocklists.push(url);
    });
  }

  return {
    profiles,
    blocklists,
    redirects,
    redirectExclusions: retainCredentials ? existingRedirectExclusions : []
  };
}
