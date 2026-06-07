"use client";

import { Plus, X } from "lucide-react";
import { useLocale } from "@/lib/i18n/context";
import { Field, inputClass } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { splitEntries } from "./utils";

export function SourceListInput({
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
    <Field label={<span className="inline-flex items-center gap-1.5">{label}{tooltip ? <Tooltip text={tooltip} /> : null}</span>} error={error}>
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
