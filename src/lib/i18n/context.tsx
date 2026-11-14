"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { LocaleKey } from "./en";
import { translate } from "./translate";

type Locale = "en" | "ru";

/** The language is remembered the way the theme is, and under a key of the same shape. */
const STORAGE_KEY = "dnsconf-locale";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: LocaleKey, params?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("ru");

  // After mount, as the theme does it: there is no localStorage while the page is rendered on the server, and a
  // value read in the render body would make the first client render disagree with the HTML it is hydrating.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "ru") setLocale(stored);
    } catch {
      // No storage, or something else wrote nonsense under the key: the page opens in its own language.
    }
  }, []);

  /** Switching the language is a choice, so it outlives the tab rather than being made again on every reload. */
  const choose = useCallback((next: Locale) => {
    setLocale(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage being unavailable costs the choice its memory, not the page its behaviour.
    }
  }, []);

  const t = useCallback(
    (key: LocaleKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale: choose, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return ctx;
}
