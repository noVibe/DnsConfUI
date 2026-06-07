"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { LocaleKey } from "./en";
import { translate } from "./translate";

type Locale = "en" | "ru";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: LocaleKey, params?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("ru");

  const t = useCallback(
    (key: LocaleKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
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
