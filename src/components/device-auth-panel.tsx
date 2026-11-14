"use client";

import { Check, ChevronDown, Copy, GitBranch, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BUILT_IN_GITHUB_CLIENT_ID, isPlausibleGitHubClientId, isUsingBuiltInGitHubClientId } from "@/domain/github-app";
import { requestGitHubDeviceCode, pollGitHubDeviceToken, type DeviceCodeResponse } from "@/lib/github/device-flow";
import { useAuth } from "./auth-provider";
import { useLocale } from "@/lib/i18n/context";
import { Button, SecondaryButton, cn, inputClass } from "./ui";

type AuthState = "idle" | "starting" | "waiting" | "done" | "error";

/**
 * A section that stays folded until it is asked for.
 *
 * A native `<details>`, like the other collapsibles in the app: nothing to keep in state, keyboard and
 * screen-reader navigable on its own, and it survives a re-render. The chevron is turned by a selector that looks
 * only at the `<details>` directly above it, because these sections nest: the usual `group-open:` class matches any
 * open ancestor, so an inner chevron would point down the moment an outer section was opened.
 */
function Collapsible({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <details className={className}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-left text-sm font-semibold text-ink/60">
        <ChevronDown
          className="size-3.5 shrink-0 text-moss transition [details[open]>summary>&]:rotate-180"
          aria-hidden="true"
        />
        {title}
      </summary>
      {children}
    </details>
  );
}

export function DeviceAuthPanel() {
  const { setToken } = useAuth();
  const { t } = useLocale();
  const fieldId = useId();
  const fieldErrorId = useId();
  const fieldHintId = useId();
  const [device, setDevice] = useState<DeviceCodeResponse | null>(null);
  const [state, setState] = useState<AuthState>("idle");
  const [message, setMessage] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const pollingRef = useRef<number | null>(null);

  /**
   * The client ID this container has been told to authorize with, which wins over the one the app ships with.
   *
   * This is how someone running the app uses an OAuth App of their own: a client ID is public by design and the
   * device flow uses no client secret, so there is nothing here to protect and nothing to rebuild - the value
   * only travels to GitHub as `client_id`. The container holds it, so every browser that opens the app gets it.
   */
  const [ownClientId, setOwnClientId] = useState("");
  const [draft, setDraft] = useState("");
  const [draftInvalid, setDraftInvalid] = useState(false);

  // Asked for after mount, because the container is what holds it: there is nothing to read while the page is
  // rendered on the server, and a value read in the render body would make the first client render disagree
  // with the HTML it is hydrating.
  useEffect(() => {
    let mounted = true;
    fetch("/api/github/client-id")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const stored = typeof body?.clientId === "string" ? body.clientId : "";
        if (!mounted || stored === "") return;
        setOwnClientId(stored);
        setDraft(stored);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        window.clearTimeout(pollingRef.current);
      }
    };
  }, []);

  const clientId = ownClientId || BUILT_IN_GITHUB_CLIENT_ID;
  const usesSharedApp = isUsingBuiltInGitHubClientId(clientId);
  // Only reachable in a build whose client ID was deliberately emptied; the field below is the way out of it.
  const noClientId = clientId === "";

  /**
   * Takes a client ID into use, or forgets it when given an empty string.
   *
   * A device code can only be redeemed by the app it was issued to, so changing the app throws away the code in
   * hand and stops it being polled instead of letting the flow fail later with a puzzling answer from GitHub.
   */
  function adoptClientId(value: string) {
    if (pollingRef.current) window.clearTimeout(pollingRef.current);
    setOwnClientId(value);
    // Told to the container, so the next browser to open the app authorizes with it too. A failure here costs it
    // that and nothing more: every device-flow request carries the ID this panel is holding.
    void fetch("/api/github/client-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: value })
    }).catch(() => {});
    setDraft(value);
    setDraftInvalid(false);
    setDevice(null);
    setState("idle");
    setMessage("");
  }

  function applyClientId(event: FormEvent) {
    event.preventDefault();
    const typed = draft.trim();
    if (typed !== "" && !isPlausibleGitHubClientId(typed)) {
      setDraftInvalid(true);
      return;
    }
    adoptClientId(typed);
  }

  async function start() {
    if (!clientId) {
      setState("error");
      setMessage(t('auth.clientIdRequired'));
      return;
    }

    // A restart replaces the device code, so the old one is no longer polled.
    if (pollingRef.current) window.clearTimeout(pollingRef.current);
    setState("starting");
    setMessage("");

    try {
      const response = await requestGitHubDeviceCode(ownClientId);
      setDevice(response);
      setState("waiting");
      copyCode(response);
      schedulePoll(response.device_code, response.interval);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : t('auth.couldNotStart'));
    }
  }

  async function copyCode(response: DeviceCodeResponse) {
    navigator.clipboard?.writeText(response.user_code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function schedulePoll(deviceCode: string, interval: number) {
    pollingRef.current = window.setTimeout(async () => {
      if (!clientId) {
        return;
      }

      try {
        const result = await pollGitHubDeviceToken(deviceCode, ownClientId);

        if ("access_token" in result) {
          setToken(result.access_token);
          setState("done");
          return;
        }

        if (result.error === "authorization_pending") {
          schedulePoll(deviceCode, interval);
          return;
        }

        if (result.error === "slow_down") {
          schedulePoll(deviceCode, interval + 5);
          return;
        }

        setState("error");
        setMessage(result.error_description ?? t('auth.notCompleted'));
      } catch {
        setState("error");
        setMessage(t('auth.pollingFailed'));
      }
    }, interval * 1000);
  }

  /** The field that points the app at an OAuth App of the user's own. */
  function clientIdForm() {
    return (
      <div className="mt-3 space-y-2">
        <a
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-steel"
          href="https://github.com/settings/developers"
          target="_blank"
          rel="noreferrer"
        >
          <GitBranch className="size-3.5" aria-hidden="true" />
          {t('auth.openGhDev')}
        </a>
        <form onSubmit={applyClientId} className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label htmlFor={fieldId} className="text-xs font-medium text-ink/70">
              {t('auth.app.fieldLabel')}
            </label>
            <input
              id={fieldId}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDraftInvalid(false);
              }}
              placeholder="Ov23li…"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={draftInvalid}
              aria-describedby={draftInvalid ? fieldErrorId : fieldHintId}
              className={cn(inputClass, "mt-1 h-9 min-h-0 py-0 text-sm", draftInvalid && "border-coral")}
            />
          </div>
          <SecondaryButton type="submit" className="min-h-9 px-3 py-1.5 text-xs">
            {t('auth.app.apply')}
          </SecondaryButton>
        </form>
        {draftInvalid ? (
          <p id={fieldErrorId} className="text-xs text-coral">
            {t('auth.app.fieldInvalid')}
          </p>
        ) : null}
        <p id={fieldHintId} className="text-xs leading-5 text-ink/50">
          {t('auth.app.fieldHint')}
        </p>
        {/* This field is the whole of it: there is no file to edit and nothing to rebuild. */}
        {ownClientId ? (
          <p className="text-xs leading-5 text-ink/60">
            {t('auth.app.inUse', { clientId: ownClientId })}{" "}
            <button type="button" onClick={() => adoptClientId("")} className="underline hover:text-ink">
              {t('auth.app.forget')}
            </button>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section aria-labelledby="connect-title">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-mint p-3 text-moss">
          <GitBranch className="size-6" aria-hidden="true" />
        </div>
        <div>
          <h2 id="connect-title" className="text-2xl font-semibold text-ink">
            {t('auth.connect')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink/70">
            {t('auth.deviceFlowDesc')}
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-line bg-paper p-4">
        {noClientId ? (
          <div className="space-y-3">
            <div className="text-base font-semibold text-ink">{t('auth.app.missingTitle')}</div>
            <p className="text-sm leading-6 text-ink/70">{t('auth.app.missing')}</p>
            {clientIdForm()}
          </div>
        ) : device && state !== "error" ? (
          /*
            A failed authorization goes back to this panel's first screen rather than leaving the dead code on
            display. Every error that gets here is terminal - the code was denied, expired, or the app ran into
            GitHub's hourly limit - so the code in hand is worthless, and the one thing that would help, a client
            ID of the user's own, is on that screen. The error itself and the restart button are below, unchanged.
          */
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-ink/70">{t('auth.enterCode')}</div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(device.user_code).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="group relative mt-2 w-full cursor-pointer rounded-md border border-line bg-white px-4 py-3 text-center text-3xl font-semibold tracking-widest text-ink transition hover:border-steel"
              >
                {device.user_code}
                <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-ink/5 p-1.5 text-ink/40 transition group-hover:bg-ink/10 group-hover:text-ink/70">
                  {copied ? <Check className="size-4 text-moss" /> : <Copy className="size-4" />}
                </span>
              </button>
              {copied ? (
                <div className="mt-1 text-right text-xs text-moss">{t('auth.copied')}</div>
              ) : (
                <div className="mt-1 text-right text-xs text-ink/50">{t('auth.clickToCopy')}</div>
              )}
            </div>
            <a
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-steel"
              href={device.verification_uri}
              target="_blank"
              rel="noreferrer"
            >
              <KeyRound className="size-4" aria-hidden="true" />
              {t('auth.openGhVerification')}
            </a>
            <div className="flex items-center gap-2 text-sm text-ink/65">
              {state === "waiting" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {state === "waiting" ? t('auth.codeCopied') : null}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/*
              Folded by default, and three lines when it is opened: which key signs you in matters, but it is not
              what the page is for, and paragraphs of it standing between the user and the one button they came to
              press was the whole problem. What is left is the shared key, its limit, and the way out of the limit -
              the field right underneath. Nothing here repeats the panel's own opening line about the token.
            */}
            <Collapsible
              title={usesSharedApp ? t('auth.app.sharedTitle') : t('auth.app.ownTitle')}
              className="rounded-md border border-line bg-white p-3"
            >
              {usesSharedApp ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-ink/72">
                  <li>{t('auth.app.pointShared')}</li>
                  <li>{t('auth.app.pointLimit')}</li>
                  <li>{t('auth.app.pointOwn')}</li>
                </ul>
              ) : null}
              {clientIdForm()}
            </Collapsible>
            <p className="text-sm leading-6 text-ink/70">
              {t('auth.permissions')}
            </p>
            <Button className="w-full" onClick={start} disabled={state === "starting"}>
              {state === "starting" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <GitBranch className="size-4" aria-hidden="true" />
              )}
              {state === "starting" ? t('wizard.connecting') : t('auth.start')}
            </Button>
          </div>
        )}
      </div>

      {state === "error" ? (
        <div className="mt-4 rounded-md border border-coral/30 bg-coral/10 p-3 text-sm text-ink">
          {message}
        </div>
      ) : null}

      {device ? (
        <SecondaryButton className="mt-4 w-full" onClick={start}>
          {t('auth.restart')}
        </SecondaryButton>
      ) : null}
    </section>
  );
}
