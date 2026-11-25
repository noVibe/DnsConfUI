"use client";

import { Info } from "lucide-react";
import { cn } from "@/components/ui";

export function Tooltip({ text, className, align = "center" }: { text: string; className?: string; align?: "center" | "end" }) {
  return (
    <span className="group/tooltip relative inline-flex" role="note" aria-label={text} tabIndex={0}>
      <Info className={cn("size-3.5 text-ink/40", className)} />
      <div className={cn(
        "pointer-events-none invisible absolute bottom-full z-10 mb-2 w-64 whitespace-normal rounded-md border border-line bg-white px-3 py-2 text-xs font-normal text-ink/80 opacity-0 shadow-sm transition-all delay-150 duration-150 group-hover/tooltip:visible group-hover/tooltip:opacity-100 group-focus/tooltip:visible group-focus/tooltip:opacity-100",
        // "end" opens towards the left so tooltips near the right edge stay on screen.
        align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"
      )}>
        {text}
      </div>
    </span>
  );
}
