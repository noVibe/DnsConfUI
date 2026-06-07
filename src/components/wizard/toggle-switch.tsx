"use client";

import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";

export function ToggleSwitch({
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
          {tooltip ? <Tooltip text={tooltip} /> : null}
        </div>
        {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
      </div>
    </label>
  );
}
