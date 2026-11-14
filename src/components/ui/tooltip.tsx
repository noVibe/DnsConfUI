"use client";

import { Info } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/components/ui";

/** Breathing room between the icon and its box, and between the box and the edge of the window. */
const GAP = 8;
/** A pointer passing over an icon on its way elsewhere should not flash a box at the reader. */
const OPEN_DELAY_MS = 150;

type At = { readonly left: number; readonly top: number };

/**
 * An explanatory box on an information icon, placed from the measured boxes rather than by CSS alignment.
 *
 * The box is 256px wide and the icons that own one sit wherever their label ends, so on a narrow window there is no
 * fixed alignment that works: centring it on the icon runs off the left edge, starting it at the icon runs off the
 * right, and an `align` flag per call site only moves the problem to the other edge when the window changes size.
 * Here the box is laid out once it is open, its own width is measured, and it is put where it fits: centred on the
 * icon where there is room, pushed back inside the window where there is not, and below the icon rather than above
 * when the room above has run out.
 *
 * The icon keeps the whole text in `aria-label`, so a screen reader gets it whether or not the box is on screen.
 */
export function Tooltip({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<At | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
    setAt(null);
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Before paint, so the box is never seen at the corner it was rendered in on its way to where it belongs.
  useLayoutEffect(() => {
    if (!open) return;
    const icon = anchorRef.current?.getBoundingClientRect();
    const box = boxRef.current?.getBoundingClientRect();
    if (!icon || !box) return;
    const rightmost = Math.max(GAP, window.innerWidth - box.width - GAP);
    const above = icon.top - box.height - GAP;
    setAt({
      left: Math.min(Math.max(GAP, icon.left + icon.width / 2 - box.width / 2), rightmost),
      top: above >= GAP ? above : icon.bottom + GAP
    });
  }, [open, text]);

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      role="note"
      aria-label={text}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <Info className={cn("size-3.5 text-ink/40", className)} />
      {open ? (
        <div
          ref={boxRef}
          // Fixed, so the box is placed against the window it has to stay inside rather than against whichever
          // ancestor happens to be positioned. It is kept hidden for the one frame it takes to measure it.
          style={{ left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? "visible" : "hidden" }}
          className="fixed z-20 w-[min(16rem,calc(100vw-1rem))] whitespace-normal rounded-md border border-line bg-white px-3 py-2 text-xs font-normal text-ink/80 shadow-sm"
        >
          {text}
        </div>
      ) : null}
    </span>
  );
}
