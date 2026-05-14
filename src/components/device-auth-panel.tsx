"use client";

import { Check, Copy, GitBranch, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { requestGitHubDeviceCode, pollGitHubDeviceToken, type DeviceCodeResponse } from "@/lib/github/device-flow";
import { useAuth } from "./auth-provider";
import { Button, SecondaryButton } from "./ui";

type AuthState = "idle" | "starting" | "waiting" | "done" | "error";

export function DeviceAuthPanel() {
  const { setToken } = useAuth();
  const [device, setDevice] = useState<DeviceCodeResponse | null>(null);
  const [state, setState] = useState<AuthState>("idle");
  const [message, setMessage] = useState<string>("");
  const pollingRef = useRef<number | null>(null);
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        window.clearTimeout(pollingRef.current);
      }
    };
  }, []);

  const [copied, setCopied] = useState(false);

  async function start() {
    if (!clientId) {
      setState("error");
      setMessage("NEXT_PUBLIC_GITHUB_CLIENT_ID is required to start GitHub authorization.");
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
      setMessage(error instanceof Error ? error.message : "GitHub authorization could not be started.");
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
        setMessage(result.error_description ?? "GitHub authorization was not completed.");
      } catch {
        setState("error");
        setMessage("GitHub authorization polling failed.");
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
            Connect GitHub
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink/70">
            Authorization uses GitHub Device Flow. The app never uses an OAuth client secret and
            never stores the token after refresh.
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-line bg-paper p-4">
        {!clientId ? (
          <div className="space-y-3">
            <div className="text-base font-semibold text-ink">Developer setup required</div>
            <p className="text-sm leading-6 text-ink/70">
              This local preview is missing the public GitHub client ID. In production, users do
              not create OAuth apps or configure GitHub developer settings; they only press
              Connect GitHub and approve access.
            </p>
            <div className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink/72">
              NEXT_PUBLIC_GITHUB_CLIENT_ID=your_client_id
            </div>
            <p className="text-sm leading-6 text-ink/70">
              For local development, the app owner creates one GitHub OAuth App, enables Device
              Flow for it, and puts its client ID in `.env.local`.
            </p>
            <a
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-steel"
              href="https://github.com/settings/developers"
              target="_blank"
              rel="noreferrer"
            >
              <GitBranch className="size-4" aria-hidden="true" />
              Open GitHub developer settings
            </a>
          </div>
        ) : device ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-ink/70">Enter this code on GitHub</div>
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
                <div className="mt-1 text-right text-xs text-moss">Copied!</div>
              ) : (
                <div className="mt-1 text-right text-xs text-ink/50">Click to copy</div>
              )}
            </div>
            <a
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-steel"
              href={device.verification_uri}
              target="_blank"
              rel="noreferrer"
            >
              <KeyRound className="size-4" aria-hidden="true" />
              Open GitHub verification
            </a>
            <div className="flex items-center gap-2 text-sm text-ink/65">
              {state === "waiting" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {state === "waiting" ? "Code copied — click the button above to open GitHub and paste it" : null}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-ink/70">
              You will grant `repo`, `workflow`, and `read:user` permissions so the browser can
              create your DnsConf fork and configure Actions.
            </p>
            <Button className="w-full" onClick={start} disabled={state === "starting"}>
              {state === "starting" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <GitBranch className="size-4" aria-hidden="true" />
              )}
              {state === "starting" ? "Contacting GitHub" : "Start GitHub connection"}
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
          Restart authorization
        </SecondaryButton>
      ) : null}
    </section>
  );
}
