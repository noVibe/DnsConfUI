import { locale as enLocale, type LocaleKey } from "./en";
import { locale as ruLocale } from "./ru";

type Locale = "en" | "ru";

const locales: Record<Locale, Record<LocaleKey, string>> = {
  en: enLocale,
  ru: ruLocale,
};

export function translate(locale: Locale, key: LocaleKey, params?: Record<string, string | number>): string {
  let text = locales[locale]?.[key] ?? enLocale[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
