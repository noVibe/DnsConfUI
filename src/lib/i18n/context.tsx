"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { locale as enLocale, type LocaleKey } from "./en";
import { locale as ruLocale } from "./ru";

type Locale = "en" | "ru";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: LocaleKey, params?: Record<string, string | number>) => string;
};

const locales: Record<Locale, Record<LocaleKey, string>> = {
  en: enLocale,
  ru: ruLocale,
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("ru");

  const t = useCallback(
    (key: LocaleKey, params?: Record<string, string | number>) => {
      let text = locales[locale]?.[key] ?? enLocale[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }
      return text;
    },
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
