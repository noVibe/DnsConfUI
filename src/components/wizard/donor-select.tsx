"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { DNS_DONORS, isDnsDonorPreset } from "@/domain/dns-donors";
import { useLocale } from "@/lib/i18n/context";
import { cn } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { ChatgptCheck, DnsCheck, StatusIcon, useDonorChecks } from "./donor-checks";

// Selected mark, donor name, DNS check, chatgpt.com check.
const ROW_GRID = "grid grid-cols-[0.875rem_minmax(0,1fr)_4.5rem_6rem] items-center gap-1.5";
// Vertical line between the DNS and chatgpt.com columns, stretched over the row padding so it stays continuous.
const DIVIDER = "-my-1.5 self-stretch border-l border-line py-1.5 pl-2";

export function DonorSelect({
  value,
  onChange,
  label
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const { t } = useLocale();
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { runChecks, statusOf } = useDonorChecks();

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const options = [
    ...(isDnsDonorPreset(value) ? [] : [{ label: `${t("profiles.donorCustom")}: ${value}`, value, preset: false }]),
    ...DNS_DONORS.map((donor) => ({ label: donor.label, value: donor.value, preset: true }))
  ];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const optionId = (index: number) => `${id}-option-${index}`;

  // The header sits outside the scrolling list, so it is padded by the scrollbar width to keep the columns aligned.
  useLayoutEffect(() => {
    if (open && listRef.current) setScrollbarWidth(listRef.current.offsetWidth - listRef.current.clientWidth);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  function openList() {
    setActive(selectedIndex);
    setOpen(true);
    runChecks();
  }

  function choose(index: number) {
    onChange(options[index].value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    const keys: Record<string, () => void> = open
      ? {
          ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
          ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
          Home: () => setActive(0),
          End: () => setActive(last),
          Enter: () => choose(active),
          " ": () => choose(active),
          Escape: () => setOpen(false)
        }
      : { ArrowDown: openList, ArrowUp: openList, Enter: openList, " ": openList };
    if (event.key === "Tab") return setOpen(false);
    const handler = keys[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  }

  const selected = options[selectedIndex];
  const selectedStatus = selected.preset ? statusOf(selected.value) : null;

  return (
    <div ref={rootRef} className="relative w-56 min-w-0 max-w-full">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open ? optionId(active) : undefined}
        title={value}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className="flex h-5 w-full items-center gap-1.5 rounded-md border border-line bg-white px-2 text-left text-xs text-ink outline-none focus:border-steel focus:ring-2 focus:ring-steel/20"
      >
        <span className="min-w-0 flex-1 truncate">{selected.label}</span>
        {selectedStatus ? (
          <>
            <StatusIcon status={selectedStatus.dns} label={selectedStatus.dnsText} />
            <StatusIcon status={selectedStatus.chatgpt} label={selectedStatus.chatgptText} />
          </>
        ) : null}
        <ChevronDown aria-hidden="true" className={cn("size-3.5 shrink-0 text-ink/50 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] rounded-md border border-line bg-white text-xs text-ink shadow-soft">
          <div className={cn(ROW_GRID, "border-b border-line py-1.5 pl-2 text-[11px] text-ink/50")} style={{ paddingRight: `calc(0.5rem + ${scrollbarWidth}px)` }}>
            <span />
            <span className="flex items-center gap-1">
              {t("profiles.donorCheckHeader")}
              <Tooltip text={t("profiles.donorCheckTooltip")} className="size-3" />
            </span>
            <span className="flex items-center gap-1">DNS<Tooltip text={t("profiles.donorCheckDnsHint")} className="size-3" /></span>
            <span className={cn(DIVIDER, "flex items-center gap-1")}>ChatGPT<Tooltip text={t("profiles.donorCheckChatgptHint")} className="size-3" align="end" /></span>
          </div>
          <ul ref={listRef} id={`${id}-listbox`} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto rounded-b-md">
            {options.map((option, index) => {
              const status = option.preset ? statusOf(option.value) : null;
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  aria-label={status ? `${option.label}. ${status.dnsText}. ${status.chatgptText}` : option.label}
                  title={option.value}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                  className={cn(
                    ROW_GRID,
                    "cursor-pointer px-2 py-1.5",
                    index === active && "bg-mint",
                    isSelected && "font-medium"
                  )}
                >
                  <Check aria-hidden="true" className={cn("size-3.5 text-moss", !isSelected && "invisible")} />
                  <span className="truncate">{option.label}</span>
                  {status ? (
                    <>
                      <DnsCheck status={status} />
                      <ChatgptCheck status={status} className={DIVIDER} />
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
