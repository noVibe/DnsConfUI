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
import { createGitHubRequest, isForkBehind, provisionDnsConfRepository, starRepository, syncFork, type ProvisionResult } from "@/lib/github/provisioning";
import { useAuth } from "./auth-provider";
import { Button, Field, SecondaryButton, inputClass, textareaClass } from "./ui";

export function SetupWizard() {
  const { token, setToken } = useAuth();
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [starred, setStarred] = useState(false);
  const [starring, setStarring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [needsSync, setNeedsSync] = useState<boolean | null>(null);
  const [userLogin, setUserLogin] = useState<string | null>(null);
  const form = useForm<DnsConfConfig>({ defaultValues: defaultDnsConfConfig, mode: "onChange" });
  const values = form.watch();
  const normalizedValues = normalizeValues(values);
  const parsed = dnsConfConfigSchema.safeParse(normalizedValues);
  const payload = useMemo(() => (parsed.success ? buildDnsConfPayload(parsed.data) : null), [parsed]);

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

      if (!curId) {
        next[i] = { ...next[i], provider: "" };
      } else {
        const len = curId.length;
        const detected = len === 32 ? "cloudflare" : len === 6 ? "nextdns" : null;
        if (detected) {
          next[i] = { ...next[i], provider: detected };
        }
      }
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
      setMessage("Configuration is incomplete or GitHub authorization has expired.");
      return;
    }

    setStatus("running");
    setMessage("");

    try {
      const provisionResult = await provisionDnsConfRepository({
        ...dnsConfWorkflow,
        payload: buildDnsConfPayload(parsedConfig.data),
        request: createGitHubRequest(token)
      });
      setResult(provisionResult);
      setStatus("done");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "GitHub provisioning failed.");
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

  return (
    <section aria-labelledby="setup-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="setup-title" className="text-2xl font-semibold text-ink">
            Environment setup
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink/70">
            Setup the DnsConf GitHub Actions secrets and variables in one pass.
          </p>
        </div>
        <SecondaryButton onClick={() => setToken(null)}>Disconnect</SecondaryButton>
      </div>

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
    </section>
  );
}

function ProfilesSection({
  profiles,
  setValue,
  profileClientIdErrors,
  profileSecretErrors
}: {
  profiles: DnsConfConfig["profiles"];
  setValue: UseFormSetValue<DnsConfConfig>;
  profileClientIdErrors?: Array<{ index: number; message: string }>;
  profileSecretErrors?: Array<{ index: number; message: string }>;
}) {
  const [selected, setSelected] = useState(0);

  function update(index: number, field: "clientId" | "authSecret" | "provider", value: string) {
    const next = [...profiles] as DnsConfConfig["profiles"];
    (next[index] as Record<string, string>)[field] = value;
    setValue("profiles", next, { shouldDirty: true, shouldValidate: true });
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
          <span className="text-sm font-medium text-ink">Profiles</span>
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
          Add profile
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
              aria-label="Remove profile"
            >
              <X className="size-4" />
            </button>
          </div>
          <Field label={<span>CLIENT_ID <span className="text-coral">*</span></span>} error={profileClientIdErrors?.find(e => e.index === selected)?.message}>
            <input className={inputClass} autoComplete="off" value={profiles[selected].clientId} onChange={(e) => update(selected, "clientId", e.target.value)} />
          </Field>
          <Field label={<span>AUTH_SECRET <span className="text-coral">*</span></span>} error={profileSecretErrors?.find(e => e.index === selected)?.message}>
            <input className={inputClass} type="password" autoComplete="off" value={profiles[selected].authSecret} onChange={(e) => update(selected, "authSecret", e.target.value)} />
          </Field>
          {profiles[selected].provider ? (
            <div>
              <div className="text-sm text-moss">DNS: {profiles[selected].provider === "cloudflare" ? "Cloudflare" : "NextDNS"}</div>
              <ScriptBehaviour provider={profiles[selected].provider as "cloudflare" | "nextdns"} />
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="text-sm leading-6 text-ink/70">
        Each profile is a separate DNS configuration. Profiles share the same BLOCK and REDIRECT sources.
      </p>
    </section>
  );
}

function ScriptBehaviour({ provider }: { provider: "cloudflare" | "nextdns" }) {
  return (
    <details className="group mt-2 text-sm leading-6 text-ink/72">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink/60">
        <ChevronDown className="size-3.5 text-moss transition group-open:rotate-180" aria-hidden="true" />
        Script behaviour
      </summary>
      {provider === "nextdns" ? (
        <div className="mt-2 space-y-1.5">
          <p>Old BLOCK/REDIRECT settings are about to be updated via provided sources.</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>If no sources provided, all NextDNS settings will be removed.</li>
            <li>Each line is mapped to an IP-domain pair; lines that cannot be parsed are skipped.</li>
            <li>If only one type of sources is provided, the other type remains untouched.</li>
            <li>EXCLUDE_REDIRECT domains affect both existing and new redirect rules.</li>
            <li>NextDNS API rate limiter: 60 seconds between requests.</li>
          </ul>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          <p>Previously generated data is always about to be removed.</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>To clear Cloudflare settings, launch without providing sources.</li>
            <li>Each line is mapped to an IP-domain pair; lines that cannot be parsed are skipped.</li>
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
              aria-label={`Remove ${label}`}
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
          Add source
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
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-4">
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 font-semibold text-ink">REDIRECT</div>
        <SourceListInput
          label="Source URLs"
          tooltip="Parses sources, filtering out lines pointing to 0.0.0.0 and 127.0.0.1. Redirect priority follows sources order — if a domain appears more than once, the first IP is applied."
          values={redirects ?? []}
          onChange={(values) =>
            setValue("redirects", values, { shouldDirty: true, shouldValidate: true })
          }
          placeholder="https://example.com/redirect-hosts.txt"
          error={redirectsError}
        />
      </div>
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 font-semibold text-ink">BLOCK</div>
        <SourceListInput
          label="Source URLs"
          tooltip="Parses sources, keeping only lines pointing to 0.0.0.0 and 127.0.0.1. Each line is mapped to an IP-domain pair. You may provide the same source for both BLOCK and REDIRECT."
          values={blocklists ?? []}
          onChange={(values) =>
            setValue("blocklists", values, { shouldDirty: true, shouldValidate: true })
          }
          placeholder="https://example.com/block-hosts.txt"
          error={blocklistsError}
        />
      </div>
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 font-semibold text-ink">EXCLUDE_REDIRECT</div>
        <Field
          label={<span className="inline-flex items-center gap-1.5">Domains<span className="group relative inline-flex"><Info className="size-3.5 text-ink/40" /><div className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-md border border-line bg-white px-3 py-2 text-xs text-ink/80 opacity-0 shadow-sm transition-all delay-150 duration-150 group-hover:visible group-hover:opacity-100">Domains (and their subdomains) to exclude from redirect rules. These will be removed from existing redirects and won't be added with new ones.</div></span></span>}
          error={redirectExclusionsError}
        >
          <textarea
            className={textareaClass}
            value={(redirectExclusions ?? []).join("\n")}
            onChange={(e) =>
              setValue("redirectExclusions", parseExcludeDomains(e.target.value), { shouldDirty: true, shouldValidate: true })
            }
            placeholder="keep.example"
          />
        </Field>
      </div>
    </section>
  );
}

function ReviewPanel({ payload, valid }: { payload: ReturnType<typeof buildDnsConfPayload> | null; valid: boolean }) {
  if (!valid || !payload) {
    return (
      <section className="rounded-lg border border-coral/30 bg-coral/10 p-4 text-sm text-ink">
        Check CLIENT_ID, AUTH_SECRET, and any provided source URLs before provisioning.
      </section>
    );
  }

  return (
    <details className="group rounded-lg border border-line bg-paper">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink">
        Review
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
                  <div className="font-medium text-ink">Profile {i + 1}</div>
                  <div className="mt-1 text-ink/70">ID: {id}</div>
                  <div className="text-ink/70">Secret: {"*".repeat(Math.min(secrets[i]?.length ?? 0, 20))}</div>
                  <div className="text-ink/70">DNS: {dns[i] ?? ""}</div>
                </div>
              ))}
            </div>
          );
        })()}
        <SummaryLine label="BLOCK" value={payload.variables.BLOCK || "None"} />
        <SummaryLine label="REDIRECT" value={payload.variables.REDIRECT || "None"} />
        <SummaryLine label="EXCLUDE_REDIRECT" value={payload.variables.EXCLUDE_REDIRECT || "None"} />
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
  return (
    <section className="rounded-lg border border-line bg-paper p-4">
      <h3 className="font-semibold text-ink">Provision GitHub</h3>
      <p className="mt-2 text-sm leading-6 text-ink/72">
        The browser will configure your DnsConf fork and dispatch `github_action.yml` on `main` branch.
      </p>
      {needsSync && status === "idle" ? (
        <button
          type="button"
          onClick={onSync}
          disabled={synced || syncing}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-moss/40 bg-white px-3 py-2 text-sm font-medium text-moss transition hover:bg-moss/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <GitBranch className="size-4" aria-hidden="true" />
          {syncing ? "Syncing…" : synced ? "Synced!" : "Sync fork"}
        </button>
      ) : null}

      <Button className="mt-4 w-full" onClick={onProvision} disabled={disabled}>
        {status === "running" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
        {status === "running" ? "Provisioning" : "Provision repository"}
      </Button>

      {status === "done" && result ? (
        <div className="mt-4 space-y-3 rounded-md border border-moss/30 bg-mint p-3 text-sm text-ink">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4 text-moss" aria-hidden="true" />
            Repository configured
          </div>
          {result.workflowRunUrl ? (
            <a
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-moss px-3 py-2 text-sm font-medium text-white transition hover:bg-steel"
              href={result.workflowRunUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Play className="size-4" aria-hidden="true" />
              Open workflow run
            </a>
          ) : null}
          <button
            type="button"
            onClick={onStar}
            disabled={starred || starring}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-moss/40 bg-white px-3 py-2 text-sm font-medium text-moss transition hover:bg-moss/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Star className={`size-4 ${starred ? "fill-moss text-moss" : ""}`} aria-hidden="true" />
            {starring ? "Starring…" : starred ? "Starred!" : "Give a Star!"}
          </button>
          {(needsSync || syncing || synced) ? (
            <button
              type="button"
              onClick={onSync}
              disabled={synced || syncing}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-moss/40 bg-white px-3 py-2 text-sm font-medium text-moss transition hover:bg-moss/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <GitBranch className="size-4" aria-hidden="true" />
              {syncing ? "Syncing…" : synced ? "Synced!" : "Sync fork"}
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
