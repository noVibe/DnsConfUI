"use client";

import { useId, type ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";

export function ToggleSwitch({
  checked,
  onChange,
  label,
  tooltip,
  children,
  disabled = false
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  tooltip?: string;
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  const inputId = useId();

  return (
    <div className={`flex items-start gap-3 rounded-lg border border-line bg-white p-4 transition ${disabled ? "opacity-55" : "hover:border-steel"}`}>
      <label htmlFor={inputId} className={`relative mt-0.5 shrink-0 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-label={label}
          className="peer sr-only"
        />
        <div className="h-5 w-9 rounded-full bg-line transition peer-checked:bg-moss" />
        <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-4" />
      </label>
      <div className="flex flex-1 items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <label htmlFor={inputId} className={`${disabled ? "cursor-not-allowed" : "cursor-pointer"} text-sm font-medium text-ink`}>{label}</label>
          {tooltip ? <Tooltip text={tooltip} /> : null}
        </div>
        {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
      </div>
    </div>
  );
}
