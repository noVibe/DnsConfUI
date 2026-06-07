import type { LocaleKey } from "@/lib/i18n/en";
import type { DnsConfConfig } from "@/domain/dnsconf-config";

export function fieldError(parsed: { success: boolean; error?: { issues: Array<{ path: Array<string | number | symbol>; message: string }> } }, field: string): string | undefined {
  if (parsed.success || !parsed.error) return undefined;
  return parsed.error.issues.find(i => i.path[0] === field)?.message;
}

export function splitEntries(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function translatedError(msg: string | undefined, t: (key: LocaleKey, params?: Record<string, string | number>) => string): string | undefined {
  if (!msg) return undefined;
  if (msg.startsWith("validation.")) return t(msg as LocaleKey);
  return msg;
}

export function extractProfileErrors(parsed: { success: boolean; error?: { issues: Array<{ path: Array<string | number | symbol>; message: string }> } }, field: "clientId" | "authSecret") {
  if (parsed.success || !parsed.error) return undefined;
  return parsed.error.issues
    .filter(i => i.path[0] === "profiles" && typeof i.path[1] === "number" && i.path[2] === field)
    .map(i => ({ index: i.path[1] as number, message: i.message }));
}

export function parseExcludeDomains(value: string): string[] {
  return value
    .split(/[\s,;/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeValues(values: DnsConfConfig): DnsConfConfig {
  return {
    ...values,
    blocklists: splitEntries((values.blocklists ?? []).join("\n")),
    redirects: splitEntries((values.redirects ?? []).join("\n")),
    redirectExclusions: parseExcludeDomains((values.redirectExclusions ?? []).join(" "))
  };
}
