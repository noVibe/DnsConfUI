"use client";

import { CheckCircle2, ChevronDown, GitBranch, Info, Loader2, Play, Plus, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, type UseFormSetValue } from "react-hook-form";
import {
  buildDnsConfPayload,
  defaultDnsConfConfig,
  dnsConfConfigSchema,
  dnsConfWorkflow,
  type DnsConfConfig,
  type Profile
} from "@/domain/dnsconf-config";
import { GEOBLOCK_HOSTS_URL, ADBLOCK_HOSTS_URL, OISD_SMALL_URL } from "@/domain/toggles";
import { configureNextDNSProfile, validateCredentials } from "@/lib/nextdns/api";
import { createGitHubRequest, isForkBehind, provisionDnsConfRepository, starRepository, syncFork, type ProvisionResult } from "@/lib/github/provisioning";
import { useLocale } from "@/lib/i18n/context";
import { useAuth } from "./auth-provider";
import { Button, cn, Field, SecondaryButton, inputClass, textareaClass } from "./ui";

export function SetupWizard() {
  const { token, setToken } = useAuth();
  const { t } = useLocale();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [starred, setStarred] = useState(false);
  const [starring, setStarring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [needsSync, setNeedsSync] = useState<boolean | null>(null);
  const [userLogin, setUserLogin] = useState<string | null>(null);
  const [mode, setMode] = useState<"quick" | "expert">("quick");
  const [geoBlock, setGeoBlock] = useState(true);
  const [geoHideChecked, setGeoHideChecked] = useState(true);
  const [malwChecked, setMalwChecked] = useState(true);
  const [blockAds, setBlockAds] = useState(true);
  const [disguisedTrackers, setDisguisedTrackers] = useState(true);
  const [nativeTracking, setNativeTracking] = useState(true);
  const [quickSteps, setQuickSteps] = useState<{ id: string; label: string; status: "pending" | "running" | "done" | "error" | "skipped" }[]>([]);
  const form = useForm<DnsConfConfig>({ defaultValues: defaultDnsConfConfig, mode: "onChange" });
  const values = form.watch();
  const normalizedValues = normalizeValues(values);
  const parsed = dnsConfConfigSchema.safeParse(normalizedValues);
  const payload = useMemo(() => (parsed.success ? buildDnsConfPayload(parsed.data) : null), [parsed]);

  const hasToggles = geoBlock || blockAds || disguisedTrackers || nativeTracking;

  const canQuickProvision = useMemo(() => {
    const profiles = values.profiles ?? [];
    if (profiles.length === 0) return false;
    const allFilled = profiles.every(p => p.clientId?.trim() && p.authSecret?.trim());
    return allFilled && hasToggles && !!profiles[0]?.provider;
  }, [values.profiles, hasToggles]);

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
        if (provider === "cloudflare") blockUrls.push(GEOBLOCK_HOSTS_URL);
        redirectUrls.push(GEOBLOCK_HOSTS_URL);
      }
      if (geoBlock && malwChecked) {
        if (provider === "cloudflare") blockUrls.push(ADBLOCK_HOSTS_URL);
        redirectUrls.push(ADBLOCK_HOSTS_URL);
      }
      if (blockAds && provider === "cloudflare") {
        if (!blockUrls.includes(GEOBLOCK_HOSTS_URL)) blockUrls.push(GEOBLOCK_HOSTS_URL);
        if (!blockUrls.includes(ADBLOCK_HOSTS_URL)) blockUrls.push(ADBLOCK_HOSTS_URL);
        if (!blockUrls.includes(OISD_SMALL_URL)) blockUrls.push(OISD_SMALL_URL);
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
      const detected = len === 32 ? "cloudflare" : len === 6 ? "nextdns" : null;
      next[i] = { ...next[i], provider: detected ?? "" };
      changed = true;
    }

    if (changed) {
      form.setValue("profiles", next, { shouldDirty: true });
    }
  }, [clientIdsJson, form.setValue]);

  useEffect(() => {
    if (!token || synced) return;
    const req = createGitHubRequest(token);
    req("GET /user").then((r: unknown) => {
      const login = (r as { data: { login: string } }).data.login;
      setUserLogin(login);
      return isForkBehind(req, login, dnsConfWorkflow.sourceRepo, dnsConfWorkflow.sourceOwner, dnsConfWorkflow.sourceRepo);
    }).then(setNeedsSync).catch(() => setNeedsSync(false));
  }, [token, synced]);

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

  async function handleSync() {
    if (!token || !userLogin) return;
    setSyncing(true);
    try {
      await syncFork(createGitHubRequest(token), userLogin, dnsConfWorkflow.sourceRepo);
      setSynced(true);
      setNeedsSync(false);
    } catch {
      setSynced(false);
    } finally {
      setSyncing(false);
    }
  }

  const providerLabel = (values.profiles?.[0]?.provider ?? null) === "nextdns" ? "NextDNS"
    : (values.profiles?.[0]?.provider ?? null) === "cloudflare" ? "Cloudflare"
    : null;

  return (
    <section aria-labelledby="setup-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="setup-title" className="text-2xl font-semibold text-ink">
            {t('wizard.setup')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink/70">
            {t('wizard.setupDesc')}
          </p>
        </div>
        <SecondaryButton onClick={() => setToken(null)}>{t('wizard.disconnect')}</SecondaryButton>
      </div>

      <div className="mt-4 flex items-center gap-1 rounded-lg border border-line bg-paper p-1">
        <button
          type="button"
          onClick={() => setMode("quick")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition",
            mode === "quick"
              ? "bg-white text-ink shadow-sm"
              : "text-ink/60 hover:text-ink"
          )}
          >
            {t('wizard.quick')}
          </button>
        <button
          type="button"
          onClick={() => setMode("expert")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition",
            mode === "expert"
              ? "bg-white text-ink shadow-sm"
              : "text-ink/60 hover:text-ink"
          )}
        >
          {t('wizard.expert')}
        </button>
      </div>

      {mode === "expert" ? (
        <div className="mt-6 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5">
            <ProfilesSection
              profiles={values.profiles ?? []}
              setValue={form.setValue}
              profileClientIdErrors={parsed.success ? undefined : parsed.error.issues.filter(i => i.path[0] === "profiles" && typeof i.path[1] === "number" && i.path[2] === "clientId").map(i => ({ index: i.path[1] as number, message: i.message }))}
              profileSecretErrors={parsed.success ? undefined : parsed.error.issues.filter(i => i.path[0] === "profiles" && typeof i.path[1] === "number" && i.path[2] === "authSecret").map(i => ({ index: i.path[1] as number, message: i.message }))}
            />
            <SourcesSection
              blocklists={values.blocklists}
              redirects={values.redirects}
              redirectExclusions={values.redirectExclusions}
              setValue={form.setValue}
              blocklistsError={fieldError(parsed, "blocklists")}
              redirectsError={fieldError(parsed, "redirects")}
              redirectExclusionsError={fieldError(parsed, "redirectExclusions")}
            />
          </div>

          <aside className="space-y-5">
            <ReviewPanel payload={payload} valid={parsed.success} />
            <ProvisionPanel
              status={status}
              message={message}
              result={result}
              onProvision={provision}
              disabled={!parsed.success || status === "running"}
              starred={starred}
              starring={starring}
              onStar={handleStar}
              syncing={syncing}
              synced={synced}
              needsSync={needsSync}
              onSync={handleSync}
            />
          </aside>
        </div>
      ) : (
        <div className="mt-6">
          <QuickModeUI
            profiles={values.profiles ?? []}
            providerLabel={providerLabel}
            setValue={form.setValue}
            profileClientIdErrors={parsed.success ? undefined : parsed.error.issues.filter(i => i.path[0] === "profiles" && typeof i.path[1] === "number" && i.path[2] === "clientId").map(i => ({ index: i.path[1] as number, message: i.message }))}
            profileSecretErrors={parsed.success ? undefined : parsed.error.issues.filter(i => i.path[0] === "profiles" && typeof i.path[1] === "number" && i.path[2] === "authSecret").map(i => ({ index: i.path[1] as number, message: i.message }))}
            geoBlock={geoBlock}
            geoHideChecked={geoHideChecked}
            malwChecked={malwChecked}
            blockAds={blockAds}
            disguisedTrackers={disguisedTrackers}
            nativeTracking={nativeTracking}
            onGeoBlockChange={setGeoBlock}
            onGeoHideChange={setGeoHideChecked}
            onMalwChange={setMalwChecked}
            onBlockAdsChange={setBlockAds}
            onDisguisedTrackersChange={setDisguisedTrackers}
            onNativeTrackingChange={setNativeTracking}
            quickSteps={quickSteps}
            onProvision={quickProvision}
            status={status}
            message={message}
            disabled={!canQuickProvision || status === "running"}
            result={result}
            starred={starred}
            starring={starring}
            onStar={handleStar}
            syncing={syncing}
            synced={synced}
            needsSync={needsSync}
            onSync={handleSync}
          />
        </div>
      )}
    </section>
  );
}

function ProfilesSection({
  profiles,
  setValue,
  profileClientIdErrors,
  profileSecretErrors,
  simplified
}: {
  profiles: DnsConfConfig["profiles"];
  setValue: UseFormSetValue<DnsConfConfig>;
  profileClientIdErrors?: Array<{ index: number; message: string }>;
  profileSecretErrors?: Array<{ index: number; message: string }>;
  simplified?: boolean;
}) {
  const { t } = useLocale();
  const [selected, setSelected] = useState(0);
  const [credStatus, setCredStatus] = useState<Record<number, { status: "idle" | "validating" | "valid" | "invalid"; message?: string }>>({});
  const validateTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => { Object.values(validateTimers.current).forEach(clearTimeout); }, []);

  useEffect(() => {
    if (!simplified) return;
    const p = profiles[selected];
    const detected = p?.clientId?.length === 32 ? "cloudflare" : p?.clientId?.length === 6 ? "nextdns" : null;
    if (!detected || !p?.authSecret?.trim() || credStatus[selected]) return;
    const timer = setTimeout(async () => {
      setCredStatus(prev => ({ ...prev, [selected]: { status: "validating" } }));
      const result = await validateCredentials(p.clientId, p.authSecret, detected);
      setCredStatus(prev => ({
        ...prev,
        [selected]: result.valid
          ? { status: "valid" }
          : { status: "invalid", message: result.error }
      }));
    }, 1000);
    validateTimers.current[selected] = timer;
  }, [selected, simplified]);

  function update(index: number, field: "clientId" | "authSecret" | "provider", value: string) {
    const next = profiles.map((p, i) =>
      i === index ? { ...p, [field]: value } : p
    ) as DnsConfConfig["profiles"];
    setValue("profiles", next, { shouldDirty: true, shouldValidate: true });

    if (!simplified) return;
    if (field !== "clientId" && field !== "authSecret") return;

    const timer = validateTimers.current[index];
    if (timer) clearTimeout(timer);

    const p = next[index];
    const len = p?.clientId?.length ?? 0;
    const detected = len === 32 ? "cloudflare" : len === 6 ? "nextdns" : null;
    if (!detected || !p?.authSecret?.trim()) return;

    validateTimers.current[index] = setTimeout(async () => {
      setCredStatus(prev => ({ ...prev, [index]: { status: "validating" } }));
      const result = await validateCredentials(p.clientId, p.authSecret, detected);
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
    setValue("profiles", next.length ? (next as DnsConfConfig["profiles"]) : [{ clientId: "", authSecret: "", provider: "" }], { shouldDirty: true, shouldValidate: true });
    if (selected >= next.length) {
      setSelected(Math.max(0, next.length - 1));
    }
  }

  function add() {
    setValue("profiles", [...profiles, { clientId: "", authSecret: "", provider: "" }] as DnsConfConfig["profiles"], { shouldDirty: true, shouldValidate: true });
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
          >
            {profiles.map((_, i) => (
              <option key={i} value={i}>Profile {i + 1}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-sm text-steel transition hover:text-ink"
        >
          <Plus className="size-4" />
          {t('profiles.add')}
        </button>
      </div>

      {profiles[selected] ? (
        <div className="space-y-3 rounded-md border border-line bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-medium text-ink/60">Profile {selected + 1}</div>
            <button
              type="button"
              onClick={() => remove(selected)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-ink/40 transition hover:border-coral hover:text-coral"
              aria-label={t('profiles.remove')}
            >
              <X className="size-4" />
            </button>
          </div>
          <Field label={<span>{t('profiles.clientId')} <span className="text-coral">*</span></span>} error={profileClientIdErrors?.find(e => e.index === selected)?.message}>
            <input className={inputClass} autoComplete="off" value={profiles[selected].clientId} onChange={(e) => update(selected, "clientId", e.target.value)} />
          </Field>
          <Field label={<span>{t('profiles.authSecret')} <span className="text-coral">*</span></span>} error={profileSecretErrors?.find(e => e.index === selected)?.message}>
            <input className={inputClass} type="password" autoComplete="off" value={profiles[selected].authSecret} onChange={(e) => update(selected, "authSecret", e.target.value)} />
          </Field>
          {simplified && credStatus[selected] ? (
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
          {profiles[selected].provider ? (
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

function ScriptBehaviour({ provider }: { provider: "cloudflare" | "nextdns" }) {
  const { t } = useLocale();
  return (
    <details className="group mt-2 text-sm leading-6 text-ink/72">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink/60">
        <ChevronDown className="size-3.5 text-moss transition group-open:rotate-180" aria-hidden="true" />
        {t('script.title')}
      </summary>
      {provider === "nextdns" ? (
        <div className="mt-2 space-y-1.5">
          <p>{t('script.oldSettings')}</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>{t('script.noSources')}</li>
            <li>{t('script.eachLine')}</li>
            <li>{t('script.oneType')}</li>
            <li>{t('script.excludeRedirect')}</li>
            <li>{t('script.rateLimit')}</li>
          </ul>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          <p>{t('script.previousData')}</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>{t('script.clearCF')}</li>
            <li>{t('script.eachLineCF')}</li>
          </ul>
        </div>
      )}
    </details>
  );
}

function SourceListInput({
  values,
  onChange,
  placeholder,
  label,
  error,
  tooltip
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  label: string;
  error?: string;
  tooltip?: string;
}) {
  const { t } = useLocale();
  function update(index: number, value: string) {
    const next = [...values];
    next[index] = value;
    onChange(next);
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  function add() {
    onChange([...values, ""]);
  }

  function handlePaste(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    const parts = splitEntries(pasted);
    if (parts.length > 1) {
      event.preventDefault();
      const next = [...values];
      next.splice(index, 1, ...parts);
      onChange(next);
    }
  }

  return (
    <Field label={<span className="inline-flex items-center gap-1.5">{label}{tooltip ? <span className="group relative inline-flex"><Info className="size-3.5 text-ink/40" /><div className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-md border border-line bg-white px-3 py-2 text-xs text-ink/80 opacity-0 shadow-sm transition-all delay-150 duration-150 group-hover:visible group-hover:opacity-100">{tooltip}</div></span> : null}</span>} error={error}>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={index} className="flex gap-2">
            <div className="group relative flex-1">
              <input
                className={inputClass}
                value={value}
                onChange={(e) => update(index, e.target.value)}
                onPaste={(e) => handlePaste(index, e)}
                placeholder={placeholder}
              />
              {value ? <div className="pointer-events-none invisible absolute left-0 top-full z-10 mt-1 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink/80 opacity-0 shadow-sm transition-all delay-150 duration-150 group-hover:visible group-hover:opacity-100">{value}</div> : null}
            </div>
            <button
              type="button"
              onClick={() => remove(index)}
              className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-ink/40 transition hover:border-coral hover:text-coral"
              aria-label={t('sources.remove', { label })}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-sm text-steel transition hover:text-ink"
        >
          <Plus className="size-4" />
          {t('sources.add')}
        </button>
      </div>
    </Field>
  );
}

function SourcesSection({
  blocklists,
  redirects,
  redirectExclusions,
  setValue,
  blocklistsError,
  redirectsError,
  redirectExclusionsError
}: {
  blocklists: string[];
  redirects: string[];
  redirectExclusions: string[];
  setValue: UseFormSetValue<DnsConfConfig>;
  blocklistsError?: string;
  redirectsError?: string;
  redirectExclusionsError?: string;
}) {
  const { t } = useLocale();
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-4">
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 font-semibold text-ink">{t('sources.redirect')}</div>
        <SourceListInput
          label={t('sources.sourceUrls')}
          tooltip={t('sources.redirectTooltip')}
          values={redirects ?? []}
          onChange={(values) =>
            setValue("redirects", values, { shouldDirty: true, shouldValidate: true })
          }
          placeholder={t('sources.redirectPlaceholder')}
          error={redirectsError}
        />
      </div>
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 font-semibold text-ink">{t('sources.block')}</div>
        <SourceListInput
          label={t('sources.sourceUrls')}
          tooltip={t('sources.blockTooltip')}
          values={blocklists ?? []}
          onChange={(values) =>
            setValue("blocklists", values, { shouldDirty: true, shouldValidate: true })
          }
          placeholder={t('sources.blockPlaceholder')}
          error={blocklistsError}
        />
      </div>
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 font-semibold text-ink">{t('sources.excludeRedirect')}</div>
        <Field
          label={<span className="inline-flex items-center gap-1.5">{t('sources.domains')}<span className="group relative inline-flex"><Info className="size-3.5 text-ink/40" /><div className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-md border border-line bg-white px-3 py-2 text-xs text-ink/80 opacity-0 shadow-sm transition-all delay-150 duration-150 group-hover:visible group-hover:opacity-100">{t('sources.excludeTooltip')}</div></span></span>}
          error={redirectExclusionsError}
        >
          <textarea
            className={textareaClass}
            value={(redirectExclusions ?? []).join("\n")}
            onChange={(e) =>
              setValue("redirectExclusions", parseExcludeDomains(e.target.value), { shouldDirty: true, shouldValidate: true })
            }
            placeholder={t('sources.excludePlaceholder')}
          />
        </Field>
      </div>
    </section>
  );
}

function ReviewPanel({ payload, valid }: { payload: ReturnType<typeof buildDnsConfPayload> | null; valid: boolean }) {
  const { t } = useLocale();
  if (!valid || !payload) {
    return (
      <section className="rounded-lg border border-coral/30 bg-coral/10 p-4 text-sm text-ink">
        {t('review.desc')}
      </section>
    );
  }

  return (
    <details className="group rounded-lg border border-line bg-paper">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink">
        {t('review.title')}
        <ChevronDown className="size-4 text-moss transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-line px-4 pb-4 pt-3 text-sm text-ink/72">
        {(() => {
          const ids = payload.secrets.CLIENT_ID.split(",");
          const secrets = payload.secrets.AUTH_SECRET.split(",");
          const dns = payload.variables.DNS.split(",");
          return (
            <div className="space-y-2">
              {ids.map((id, i) => (
                <div key={i} className="rounded-md border border-line bg-white px-3 py-2">
                  <div className="font-medium text-ink">{t('review.profile', { n: i + 1 })}</div>
                  <div className="mt-1 text-ink/70">{t('review.id', { value: id })}</div>
                  <div className="text-ink/70">{t('review.secret', { value: "*".repeat(Math.min(secrets[i]?.length ?? 0, 20)) })}</div>
                  <div className="text-ink/70">{t('review.dns', { value: dns[i] ?? "" })}</div>
                </div>
              ))}
            </div>
          );
        })()}
        <SummaryLine label="BLOCK" value={payload.variables.BLOCK || t('review.none')} />
        <SummaryLine label="REDIRECT" value={payload.variables.REDIRECT || t('review.none')} />
        <SummaryLine label="EXCLUDE_REDIRECT" value={payload.variables.EXCLUDE_REDIRECT || t('review.none')} />
      </div>
    </details>
  );
}

function ProvisionPanel({
  status,
  message,
  result,
  onProvision,
  disabled,
  starred,
  starring,
  onStar,
  syncing,
  synced,
  needsSync,
  onSync
}: {
  status: "idle" | "running" | "done" | "error";
  message: string;
  result: ProvisionResult | null;
  onProvision: () => void;
  disabled: boolean;
  starred: boolean;
  starring: boolean;
  onStar: () => Promise<void>;
  syncing: boolean;
  synced: boolean;
  needsSync: boolean | null;
  onSync: () => Promise<void>;
}) {
  const { t } = useLocale();
  return (
    <section className="rounded-lg border border-line bg-paper p-4">
      <p className="mt-2 text-sm leading-6 text-ink/72">
        {t('provision.desc')}
      </p>
      {needsSync && status === "idle" ? (
        <button
          type="button"
          onClick={onSync}
          disabled={synced || syncing}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-moss/40 bg-white px-3 py-2 text-sm font-medium text-moss transition hover:bg-moss/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <GitBranch className="size-4" aria-hidden="true" />
          {syncing ? t('provision.syncing') : synced ? t('provision.synced') : t('provision.sync')}
        </button>
      ) : null}

      <Button className="mt-4 w-full" onClick={onProvision} disabled={disabled}>
        {status === "running" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
        {status === "running" ? t('provision.applying') : t('provision.apply')}
      </Button>

      {status === "done" && result ? (
        <div className="mt-4 space-y-3 rounded-md border border-moss/30 bg-mint p-3 text-sm text-ink">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4 text-moss" aria-hidden="true" />
            {t('provision.configured')}
          </div>
          {result.workflowRunUrl ? (
            <a
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-moss px-3 py-2 text-sm font-medium text-white transition hover:bg-steel"
              href={result.workflowRunUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Play className="size-4" aria-hidden="true" />
              {t('provision.openRun')}
            </a>
          ) : null}
          <button
            type="button"
            onClick={onStar}
            disabled={starred || starring}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-moss/40 bg-white px-3 py-2 text-sm font-medium text-moss transition hover:bg-moss/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Star className={`size-4 ${starred ? "fill-moss text-moss" : ""}`} aria-hidden="true" />
            {starring ? t('provision.starring') : starred ? t('provision.starred') : t('provision.star')}
          </button>
          {(needsSync || syncing || synced) ? (
            <button
              type="button"
              onClick={onSync}
              disabled={synced || syncing}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-moss/40 bg-white px-3 py-2 text-sm font-medium text-moss transition hover:bg-moss/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <GitBranch className="size-4" aria-hidden="true" />
          {syncing ? t('provision.syncing') : synced ? t('provision.synced') : t('provision.sync')}
            </button>
          ) : null}
        </div>
      ) : null}

      {status === "error" ? (
        <div className="mt-4 rounded-md border border-coral/30 bg-coral/10 p-3 text-sm text-ink">
          {message}
        </div>
      ) : null}
    </section>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
  tooltip,
  children
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  tooltip?: string;
  children?: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-white p-4 transition hover:border-steel">
      <div className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="h-5 w-9 rounded-full bg-line transition peer-checked:bg-moss" />
        <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-4" />
      </div>
      <div className="flex flex-1 items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-ink">{label}</span>
          {tooltip ? (
            <span className="group relative inline-flex">
              <Info className="size-3.5 text-ink/40" />
              <div className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-md border border-line bg-white px-3 py-2 text-xs text-ink/80 opacity-0 shadow-sm transition-all delay-150 duration-150 group-hover:visible group-hover:opacity-100">
                {tooltip}
              </div>
            </span>
          ) : null}
        </div>
        {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
      </div>
    </label>
  );
}

function QuickModeUI({
  profiles,
  providerLabel,
  setValue,
  profileClientIdErrors,
  profileSecretErrors,
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
  onProvision,
  status,
  message,
  disabled,
  quickSteps,
  result,
  starred,
  starring,
  onStar,
  syncing,
  synced,
  needsSync,
  onSync
}: {
  profiles: DnsConfConfig["profiles"];
  providerLabel: string | null;
  setValue: UseFormSetValue<DnsConfConfig>;
  profileClientIdErrors?: Array<{ index: number; message: string }>;
  profileSecretErrors?: Array<{ index: number; message: string }>;
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
  onProvision: () => void;
  status: "idle" | "running" | "done" | "error";
  message: string;
  disabled: boolean;
  quickSteps: Array<{ id: string; label: string; status: "pending" | "running" | "done" | "error" | "skipped" }>;
  result: ProvisionResult | null;
  starred: boolean;
  starring: boolean;
  onStar: () => Promise<void>;
  syncing: boolean;
  synced: boolean;
  needsSync: boolean | null;
  onSync: () => Promise<void>;
}) {
  const { t } = useLocale();
  const isNextDNS = providerLabel === "NextDNS";
  const noToggles = !geoBlock && !blockAds && !disguisedTrackers && !nativeTracking;

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-5">
         <ProfilesSection
            profiles={profiles}
            setValue={setValue}
            profileClientIdErrors={profileClientIdErrors}
            profileSecretErrors={profileSecretErrors}
            simplified
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
              {geoBlock ? (
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1 text-xs text-ink/70 hover:text-ink">
                    <input
                      type="checkbox"
                      checked={geoHideChecked}
                      onChange={(e) => onGeoHideChange(e.target.checked)}
                      className="size-3 accent-moss"
                    />
                    <span>{t('quick.geohide')}</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-xs text-ink/70 hover:text-ink">
                    <input
                      type="checkbox"
                      checked={malwChecked}
                      onChange={(e) => onMalwChange(e.target.checked)}
                      className="size-3 accent-moss"
                    />
                    <span>{t('quick.malw')}</span>
                  </label>
                </div>
              ) : null}
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
          syncing={syncing}
          synced={synced}
          needsSync={needsSync}
          onSync={onSync}
        />
      </aside>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-medium text-ink">{label}</div>
      <div className="mt-1 whitespace-pre-wrap rounded-md bg-white px-3 py-2">{value}</div>
    </div>
  );
}

function fieldError(parsed: { success: boolean; error?: { issues: Array<{ path: Array<string | number | symbol>; message: string }> } }, field: string): string | undefined {
  if (parsed.success || !parsed.error) return undefined;
  return parsed.error.issues.find(i => i.path[0] === field)?.message;
}

function splitEntries(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseExcludeDomains(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeValues(values: DnsConfConfig): DnsConfConfig {
  return {
    ...values,
    blocklists: splitEntries((values.blocklists ?? []).join("\n")),
    redirects: splitEntries((values.redirects ?? []).join("\n")),
    redirectExclusions: parseExcludeDomains((values.redirectExclusions ?? []).join(" "))
  };
}
