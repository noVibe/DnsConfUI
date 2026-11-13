"use client";

import { Info } from "lucide-react";
import { cn } from "@/components/ui";

export function Tooltip({ text, className, align = "start" }: { text: string; className?: string; align?: "start" | "end" }) {
  return (
    <span className="group relative inline-flex" role="note" aria-label={text} tabIndex={0}>
      <Info className={cn("size-3.5 text-ink/40", className)} />
      <div className={cn(
        // The width gives way on a narrow screen rather than pushing the box off it.
        "pointer-events-none invisible absolute bottom-full z-10 mb-2 w-[min(16rem,calc(100vw-2rem))] whitespace-normal rounded-md border border-line bg-white px-3 py-2 text-xs font-normal text-ink/80 opacity-0 shadow-sm transition-all delay-150 duration-150 group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100",
        // The icon itself is always on screen, so a box that starts at it can only run off the right edge, and "end"
        // is for the icons near that edge: it opens leftwards instead. Centring the box on the icon is what used to
        // run off the left edge, because half of it is wider than the gutter left of the icons in a panel.
        align === "end" ? "right-0" : "left-0"
      )}>o
        {text}
      </div>
    </span>
  );
}
