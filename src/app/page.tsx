"use client";

import { ChevronDown, ShieldCheck, GitFork, Play, Workflow } from "lucide-react";
import { DeviceAuthPanel } from "@/components/device-auth-panel";
import { SetupWizard } from "@/components/setup-wizard";
import { useAuth } from "@/components/auth-provider";

const points = [
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
  }
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
