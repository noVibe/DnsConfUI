"use client";

import { Info } from "lucide-react";
import { cn } from "@/components/ui";

export function Tooltip({ text, className }: { text: string; className?: string }) {
  return (
    <span className="group relative inline-flex">
      <Info className={cn("size-3.5 text-ink/40", className)} />
      <div className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-md border border-line bg-white px-3 py-2 text-xs text-ink/80 opacity-0 shadow-sm transition-all delay-150 duration-150 group-hover:visible group-hover:opacity-100">
        {text}
      </div>
    </span>
  );
}
