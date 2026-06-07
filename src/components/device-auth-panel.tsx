"use client";

import { Check, Copy, GitBranch, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { requestGitHubDeviceCode, pollGitHubDeviceToken, type DeviceCodeResponse } from "@/lib/github/device-flow";
import { useAuth } from "./auth-provider";
import { useLocale } from "@/lib/i18n/context";
import { Button, SecondaryButton } from "./ui";

type AuthState = "idle" | "starting" | "waiting" | "done" | "error";

export function DeviceAuthPanel() {
  const { setToken } = useAuth();
  const { t } = useLocale();
  const [device, setDevice] = useState<DeviceCodeResponse | null>(null);
  const [state, setState] = useState<AuthState>("idle");
  const [message, setMessage] = useState<string>("");
  const pollingRef = useRef<number | null>(null);
  const gitHubClientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        window.clearTimeout(pollingRef.current);
      }
    };
  }, []);

  const [copied, setCopied] = useState(false);

  async function start() {
    if (!gitHubClientId) {
      setState("error");
      setMessage(t('auth.clientIdRequired'));
      return;
    }

    setState("starting");
    setMessage("");

    try {
      const response = await requestGitHubDeviceCode();
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
      if (!gitHubClientId) {
        return;
      }

      try {
        const result = await pollGitHubDeviceToken(deviceCode);

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
        {!gitHubClientId ? (
          <div className="space-y-3">
            <div className="text-base font-semibold text-ink">{t('auth.devSetup')}</div>
            <p className="text-sm leading-6 text-ink/70">
              {t('auth.devSetupDesc')}
            </p>
            <div className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink/72">
              {t('auth.envVar')}
            </div>
            <p className="text-sm leading-6 text-ink/70">
              {t('auth.localDevDesc')}
            </p>
            <a
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-steel"
              href="https://github.com/settings/developers"
              target="_blank"
              rel="noreferrer"
            >
              <GitBranch className="size-4" aria-hidden="true" />
              {t('auth.openGhDev')}
            </a>
          </div>
        ) : device ? (
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
