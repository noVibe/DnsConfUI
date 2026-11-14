"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * The DNS servers this browser has been told to keep out of the way.
 *
 * A view preference, not data: it lives in the browser rather than on the server, because it is this person's
 * opinion about a list everyone running the container shares. It is held in one place for the whole page so that
 * hiding a row in the monitor takes the same server out of the hosts panel's proxy list at the same moment -
 * two lists of the same servers disagreeing about which of them exist is the thing worth avoiding here.
 */
const STORAGE_KEY = "dnsconf.hidden-donors";

function readHidden(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
  } catch {
    // No storage, or something else wrote nonsense under the key: nothing is hidden, which is a fine place to start.
    return [];
  }
}

function writeHidden(values: readonly string[]): void {
  try {
    if (values.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Storage being unavailable costs the preference its memory, not the page its behaviour.
  }
}

type Store = {
  readonly hidden: ReadonlySet<string>;
  /** Hides a server, or brings it back if it was already hidden. */
  readonly toggle: (value: string) => void;
};

const HiddenDonors = createContext<Store>({ hidden: new Set(), toggle: () => {} });

export function HiddenDonorsProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  // After mount, not during render: there is no localStorage while the page is rendered on the server, and a value
  // read in the render body would make the first client render disagree with the HTML it is hydrating.
  useEffect(() => {
    setHidden(new Set(readHidden()));
  }, []);

  const toggle = useCallback(
    (value: string) => {
      const next = new Set(hidden);
      if (!next.delete(value)) next.add(value);
      writeHidden([...next]);
      setHidden(next);
    },
    [hidden]
  );

  const store = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);
  return <HiddenDonors.Provider value={store}>{children}</HiddenDonors.Provider>;
}

export function useHiddenDonors(): Store {
  return useContext(HiddenDonors);
}
