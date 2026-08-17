"use client";

import { CheckCircle2, Loader2, Play, Star } from "lucide-react";
import type { ProvisionResult } from "@/lib/github/provisioning";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui";

type Status = "idle" | "running" | "done" | "error";

function WorkflowRunLink({ href, label, className = "" }: { href: string; label: string; className?: string }) {
  return (
    <a
      className={`inline-flex w-full items-center justify-center gap-2 rounded-md bg-moss px-3 py-2 text-sm font-medium text-white transition hover:bg-steel ${className}`}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      <Play className="size-4" aria-hidden="true" />
      {label}
    </a>
  );
}

function StateButton({
  label,
  icon,
  onClick,
  disabled,
  state,
  activeLabel,
  doneLabel
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  state: "idle" | "loading" | "done";
  activeLabel: string;
  doneLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-moss/40 bg-white px-3 py-2 text-sm font-medium text-moss transition hover:bg-moss/10 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {icon}
      {state === "loading" ? activeLabel : state === "done" ? doneLabel : label}
    </button>
  );
}

function StarButton({
  starred,
  starring,
  onStar
}: {
  starred: boolean;
  starring: boolean;
  onStar: () => Promise<void>;
}) {
  const { t } = useLocale();

  return (
    <StateButton
      label={t('provision.star')}
      icon={<Star className={`size-4 ${starred ? "fill-moss text-moss" : ""}`} aria-hidden="true" />}
      onClick={onStar}
      disabled={starred || starring}
      state={starring ? "loading" : starred ? "done" : "idle"}
      activeLabel={t('provision.starring')}
      doneLabel={t('provision.starred')}
    />
  );
}

export function ProvisionPanel({
  status,
  message,
  result,
  onProvision,
  disabled,
  starred,
  starring,
  onStar,
  retainCredentials = false
}: {
  status: Status;
  message: string;
  result: ProvisionResult | null;
  onProvision: () => void;
  disabled: boolean;
  starred: boolean;
  starring: boolean;
  onStar: () => Promise<void>;
  retainCredentials?: boolean;
}) {
  const { t } = useLocale();
  return (
    <section className="rounded-lg border border-line bg-paper p-4">
      <p className="mt-2 text-sm leading-6 text-ink/72">
        {t(retainCredentials ? 'provision.retainDesc' : 'provision.desc')}
      </p>
      <Button
        className={`mt-4 w-full whitespace-nowrap ${retainCredentials && status === "running" ? "text-xs" : ""}`}
        onClick={onProvision}
        disabled={disabled}
      >
        {status === "running" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
        {status === "running"
          ? t(retainCredentials ? 'provision.retainApplying' : 'provision.applying')
          : t(retainCredentials ? 'provision.retainApply' : 'provision.apply')}
      </Button>

      {status === "running" && result?.workflowRunUrl ? (
        <div className="mt-4 space-y-3">
          <WorkflowRunLink
            href={result.workflowRunUrl}
            label={t('provision.openRun')}
          />
          <StarButton starred={starred} starring={starring} onStar={onStar} />
        </div>
      ) : null}

      {status === "done" && result ? (
        <div className="mt-4 space-y-3 rounded-md border border-moss/30 bg-mint p-3 text-sm text-ink">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4 text-moss" aria-hidden="true" />
            {t('provision.configured')}
          </div>
          {result.workflowRunUrl ? (
            <WorkflowRunLink
              href={result.workflowRunUrl}
              label={t('provision.openRun')}
            />
          ) : null}
          <StarButton starred={starred} starring={starring} onStar={onStar} />
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
