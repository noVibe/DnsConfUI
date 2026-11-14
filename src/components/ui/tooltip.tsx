"use client";

import { Info } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
 *
 * `children` put the same box on something else - a button, say - instead of on an information icon. The wrapper
 * then carries neither the role nor the label, because the thing inside it is the one a reader should be told
 * about, and a focusable note around a focusable control would be read twice and tabbed through twice.
 */
export function Tooltip({ text, className, children }: { text: string; className?: string; children?: ReactNode }) {
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

  // A box placed against the window does not travel with the page, so scrolling away from the icon closes it
  // rather than leaving it hanging where the icon used to be. That happens when the icon is reached by keyboard:
  // a pointer leaving it closes the box by itself.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);

  // Before paint, so the box is never seen at the corner it was rendered in on its way to where it belongs.
  useLayoutEffect(() => {
    if (!open) return;
    const icon = anchorRef.current?.getBoundingClientRect();
    const box = boxRef.current?.getBoundingClientRect();
    if (!icon || !box) return;
    // The document element, not the window: `innerWidth` counts the scrollbar, and a box placed against it ends up
    // under the scrollbar instead of beside it. Same for the height, so a box that has to go below an icon near
    // the bottom is pulled back up rather than hanging off the end.
    const view = document.documentElement;
    const rightmost = Math.max(GAP, view.clientWidth - box.width - GAP);
    const lowest = Math.max(GAP, view.clientHeight - box.height - GAP);
    const above = icon.top - box.height - GAP;
    setAt({
      left: Math.min(Math.max(GAP, icon.left + icon.width / 2 - box.width / 2), rightmost),
      top: Math.min(above >= GAP ? above : icon.bottom + GAP, lowest)
    });
  }, [open, text]);

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      {...(children ? {} : { role: "note", "aria-label": text, tabIndex: 0 })}
      onMouseEnter={show}
      onMouseLeave={hide}
      // Focus bubbles, so reaching the control inside by keyboard opens the box just as hovering it does.
      onFocus={show}
      onBlur={hide}
    >
      {children ?? <Info className={cn("size-3.5 text-ink/40", className)} />}
      {/*
        Rendered into the body rather than here, because what the box looks like must not depend on what it hangs
        off: a hidden row in the monitor is drawn at half opacity, and a box inside it inherited that and became
        unreadable. Out here it also keeps its own stacking, and a transformed ancestor cannot take `fixed` away
        from it.
      */}
      {open ? createPortal(
        <div
          ref={boxRef}
          // Fixed, so the box is placed against the window it has to stay inside rather than against whichever
          // ancestor happens to be positioned. It is kept hidden for the one frame it takes to measure it.
          style={{ left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? "visible" : "hidden" }}
          // `text-left` and `font-normal` for the same reason: the box reads the same wherever it is opened from,
          // and this one hangs off a right-aligned column header, which would otherwise set its text ragged-left.
          // As wide as its text and no wider, up to a limit: a three-word hint in a 16rem box is mostly empty box.
          // The limit is 2rem off the viewport, not 1rem, because on a window narrow enough for the box to reach
          // it `100vw` still counts the scrollbar, and the gap on either side has to cover it.
          // In the dark theme the box lifts off the panel it covers, the way the theme switch at the top of the
          // page does: `white` there is darker than `paper`, and a box in it reads as a hole rather than a note.
          className="fixed z-20 w-max max-w-[min(16rem,calc(100vw-2rem))] whitespace-normal rounded-md border border-line bg-white px-3 py-2 text-left text-xs font-normal text-ink/80 shadow-sm dark:bg-paper"
        >
          {text}
        </div>,
        document.body
      ) : null}
    </span>
  );
}
