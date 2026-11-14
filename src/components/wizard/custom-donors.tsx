"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isCheckableDonor, type DnsDonor } from "@/domain/dns-donors";

/** Only what this app's own route can have put there: anything else is dropped rather than shown or dialled. */
function readDonors(body: unknown): DnsDonor[] {
  const donors = (body as { donors?: unknown })?.donors;
  if (!Array.isArray(donors)) return [];
  return donors.flatMap((entry) => {
    const { label, value } = (entry ?? {}) as { label?: unknown; value?: unknown };
    if (typeof label !== "string" || typeof value !== "string" || !isCheckableDonor(value)) return [];
    return [{ label, value }];
  });
}

type Store = {
  /** The DNS proxies added while this container has been running. */
  readonly donors: readonly DnsDonor[];
  /** Adds one and answers whether it is now in the list. */
  readonly add: (url: string, label: string) => Promise<boolean>;
  /** Takes one back out, by the address it was added under. */
  readonly remove: (url: string) => Promise<void>;
};

/** Without the provider there is nothing added and nothing to add to: the presets stand on their own. */
const CustomDonors = createContext<Store>({ donors: [], add: async () => false, remove: async () => {} });

/**
 * Holds the added proxies for everything on the page.
 *
 * They are kept by the server, so the lifetime is the container's as promised rather than the tab's, and they are
 * held here rather than fetched per component so that adding one in the monitor reaches the hosts panel at once -
 * the point of adding it being that the file builder can use it too.
 */
export function CustomDonorsProvider({ children }: { children: ReactNode }) {
  const [donors, setDonors] = useState<readonly DnsDonor[]>([]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/donors/custom")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (mounted) setDonors(readDonors(body));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const add = useCallback(async (url: string, label: string): Promise<boolean> => {
    try {
      const response = await fetch("/api/donors/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, label })
      });
      if (!response.ok) return false;
      setDonors(readDonors(await response.json().catch(() => null)));
      return true;
    } catch {
      return false;
    }
  }, []);

  const remove = useCallback(async (url: string) => {
    try {
      const response = await fetch("/api/donors/custom", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      // A failure leaves the row where it is, which is the honest thing to show: the server still has it.
      if (response.ok) setDonors(readDonors(await response.json().catch(() => null)));
    } catch {
      // Same as a failed response: nothing changes here.
    }
  }, []);

  const store = useMemo(() => ({ donors, add, remove }), [donors, add, remove]);
  return <CustomDonors.Provider value={store}>{children}</CustomDonors.Provider>;
}

export function useCustomDonors(): Store {
  return useContext(CustomDonors);
}
