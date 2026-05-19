"use client";

import { ChevronDown, ShieldCheck, GitFork, Play, Workflow, Zap } from "lucide-react";
import { DeviceAuthPanel } from "@/components/device-auth-panel";
import { SetupWizard } from "@/components/setup-wizard";
import { useAuth } from "@/components/auth-provider";

const points = [
  {
    icon: Zap,
    title: "Quick setup",
    text: "Enter only credentials and pick features — geo-blocking bypass, tracker blocking, and ad blocking are configured automatically via presets."
  },
  {
    icon: GitFork,
    title: "Own fork",
    text: "DnsConf runs in the user's GitHub account, with Actions and repository ownership staying there."
  },
  {
    icon: ShieldCheck,
    title: "No stored credentials",
    text: "Provider secrets are encrypted in the browser and sent directly to GitHub Actions Secrets."
  },
  {
    icon: Workflow,
    title: "Workflow-native",
    text: "The current DnsConf workflow receives DNS, BLOCK, REDIRECT, CLIENT_ID, and AUTH_SECRET."
  },
  {
    icon: Play,
    title: "One initial run",
    text: "After provisioning, the UI dispatches the GitHub Actions workflow immediately."
  },
];

export default function Home() {
  const { token } = useAuth();

  return (
    <main className="min-h-screen">
      <section className="mx-auto grid w-full max-w-7xl gap-6 px-5 py-6 md:grid-cols-[0.62fr_1.38fr] md:px-8 md:py-8">
        <div className="flex flex-col gap-5">
          <div className="rounded-lg border border-line bg-white/80 p-4 shadow-sm">
            <div className="text-sm font-medium text-ink/60">
              Quick setup for
            </div>
            <h1 className="mt-1 text-4xl font-semibold leading-[1.04] text-ink md:text-5xl">
              <a className="hover:underline" href="https://github.com/noVibe/DnsConf" target="_blank" rel="noreferrer">noVibe/DnsConf</a>
            </h1>
          </div>
          <div className="max-w-xl">
            <p className="text-base leading-7 text-ink/72">
              Connect GitHub, enter DNS provider settings, and let the browser provision a fork,
              repository secrets, variables, and the first workflow run.
            </p>
          </div>

          <details className="rounded-lg border border-line bg-white/80 p-4 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink">
              Why this configurator exists
              <ChevronDown className="size-4 text-moss" aria-hidden="true" />
            </summary>
            <div className="mt-4 grid gap-3">
              {points.map((point) => (
                <div key={point.title} className="grid grid-cols-[auto_1fr] gap-3">
                  <point.icon className="mt-1 size-4 text-coral" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-semibold text-ink">{point.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-ink/70">{point.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </details>

          {token ? (
            <details className="rounded-lg border border-line bg-white/80 p-4 shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink">
                Where to get CLIENT_ID and AUTH_SECRET
                <ChevronDown className="size-4 text-moss" aria-hidden="true" />
              </summary>
              <div className="mt-4 space-y-3 text-sm leading-6 text-ink/72">

                <details className="rounded-md border border-line bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink">
                    NextDNS
                    <ChevronDown className="size-3.5 text-moss" aria-hidden="true" />
                  </summary>
                  <div className="border-t border-line px-4 pb-4 pt-3 space-y-3">
                    <div className="rounded-md bg-paper p-3">
                      <div className="font-medium text-ink">CLIENT_ID</div>
                      <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-ink/70">
                        <li>Go to your <a className="text-steel underline hover:text-ink" href="https://my.nextdns.io" target="_blank" rel="noreferrer">NextDNS setup page</a></li>
                        <li>Find the <strong>Endpoints</strong> section and copy ID</li>
                      </ol>
                    </div>
                    <div className="rounded-md bg-paper p-3">
                      <div className="font-medium text-ink">AUTH_SECRET</div>
                      <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-ink/70">
                        <li>Go to <a className="text-steel underline hover:text-ink" href="https://my.nextdns.io/account" target="_blank" rel="noreferrer">my.nextdns.io/account</a></li>
                        <li>Scroll to the <strong>API Key</strong> section</li>
                        <li>Generate or copy your API key</li>
                      </ol>
                    </div>
                  </div>
                </details>

                <details className="rounded-md border border-line bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink">
                    Cloudflare
                    <ChevronDown className="size-3.5 text-moss" aria-hidden="true" />
                  </summary>
                  <div className="border-t border-line px-4 pb-4 pt-3 space-y-3">
                    <div className="rounded-md bg-paper p-3">
                      <div className="font-medium text-ink">CLIENT_ID</div>
                      <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-ink/70">
                        <li>Sign in to your <a className="text-steel underline hover:text-ink" href="https://dash.cloudflare.com" target="_blank" rel="noreferrer">Cloudflare dashboard</a></li>
                        <li>Navigate to <strong>Zero Trust</strong> tab and create an account (Free Plan)</li>
                        <li>Skip the payment method step by choosing <em>Cancel and exit</em> (top right)</li>
                        <li>Go to <a className="text-steel underline hover:text-ink" href="https://dash.cloudflare.com/?to=/:account/workers" target="_blank" rel="noreferrer">dash.cloudflare.com/?to=/:account/workers</a></li>
                        <li>Copy your <strong>Account ID</strong> from the Account Details section</li>
                      </ol>
                    </div>
                    <div className="rounded-md bg-paper p-3">
                      <div className="font-medium text-ink">AUTH_SECRET</div>
                      <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-ink/70">
                        <li>Go to <a className="text-steel underline hover:text-ink" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">dash.cloudflare.com/profile/api-tokens</a></li>
                        <li>Create a new API token with these permissions:
                          <ul className="mt-1 space-y-0.5 list-disc pl-5">
                            <li><code className="rounded bg-paper px-1 text-xs">Account &gt; Zero Trust : Edit</code></li>
                            <li><code className="rounded bg-paper px-1 text-xs">Account &gt; Account Firewall Access Rules : Edit</code></li>
                          </ul>
                        </li>
                      </ol>
                    </div>
                  </div>
                </details>

              </div>
            </details>
          ) : null}
        </div>

        <div>
          <div className="w-full rounded-lg border border-line bg-white p-4 shadow-soft md:p-6">
            {token ? <SetupWizard /> : <DeviceAuthPanel />}
          </div>
        </div>
      </section>
    </main>
  );
}
