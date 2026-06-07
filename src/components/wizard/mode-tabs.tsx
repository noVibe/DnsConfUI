"use client";

import { cn } from "@/components/ui";
import { useLocale } from "@/lib/i18n/context";

export function ModeTabs({ mode, setMode }: { mode: "quick" | "expert"; setMode: (m: "quick" | "expert") => void }) {
  const { t } = useLocale();
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-paper p-1">
      <button
        type="button"
        onClick={() => setMode("quick")}
        className={cn(
          "rounded-md px-3 py-1.5 text-sm font-medium transition",
          mode === "quick"
            ? "bg-white text-ink shadow-sm"
            : "text-ink/60 hover:text-ink"
        )}
      >
        {t('wizard.quick')}
      </button>
      <button
        type="button"
        onClick={() => setMode("expert")}
        className={cn(
          "rounded-md px-3 py-1.5 text-sm font-medium transition",
          mode === "expert"
            ? "bg-white text-ink shadow-sm"
            : "text-ink/60 hover:text-ink"
        )}
      >
        {t('wizard.expert')}
      </button>
    </div>
  );
}
