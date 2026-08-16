import { z } from "zod";
import { CLOUDFLARE_CLIENT_ID_LENGTH, NEXTDNS_CLIENT_ID_LENGTH } from "@/lib/constants";
import { DEFAULT_DNS_DONOR, DISABLED_DNS_DONOR } from "./dns-donors";

const dnsProviderSchema = z.enum(["cloudflare", "nextdns"]);

const sourceConfigFields = {
  blocklists: z.array(z.string().trim().url("Enter a valid URL")).default([]),
  redirects: z.array(z.string().trim().url("Enter a valid URL")).default([]),
  redirectExclusions: z.array(z.string().trim().min(1, "Enter a domain name").refine(v => !v.includes("://"), "Use a domain name, not a URL")).default([])
};

export const profileSchema = z.object({
  clientId: z.string().trim().min(1, "validation.clientIdRequired"),
  authSecret: z.string().trim().min(1, "validation.authSecretRequired"),
  provider: dnsProviderSchema.or(z.literal("")),
  donorDns: z.string().trim().refine(
    (value) => value === "" || isValidDonorDns(value),
    "profiles.donorInvalid"
  )
});

export const dnsConfConfigSchema = z
  .object({
    profiles: z.array(profileSchema).min(1),
    ...sourceConfigFields
  })
  .superRefine((data, ctx) => {
    for (const [index, profile] of data.profiles.entries()) {
      const len = profile.clientId.length;
      if (len === 0) continue;
      const expected = profile.provider === "nextdns" ? NEXTDNS_CLIENT_ID_LENGTH : CLOUDFLARE_CLIENT_ID_LENGTH;
      if (len !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profiles", index, "clientId"],
          message: "validation.clientIdFormat"
        });
      }
    }
  });

export const retainedCredentialsConfigSchema = z.object({
  profiles: z.array(profileSchema.extend({
    clientId: z.literal(""),
    authSecret: z.literal(""),
    provider: dnsProviderSchema
  })).min(1),
  ...sourceConfigFields
});

export type DnsConfConfig = z.infer<typeof dnsConfConfigSchema>;

export type Profile = z.infer<typeof profileSchema>;

export type DnsConfPayload = {
  secrets: Partial<Record<"CLIENT_ID" | "AUTH_SECRET", string>>;
  variables: Record<"DNS" | "BLOCK" | "REDIRECT" | "EXCLUDE_REDIRECT" | "DONOR_DNS", string>;
};

export const defaultDnsConfConfig: DnsConfConfig = {
  profiles: [{ clientId: "", authSecret: "", provider: "", donorDns: DEFAULT_DNS_DONOR }],
  blocklists: [],
  redirects: [],
  redirectExclusions: []
};

export function buildDnsConfPayload(
  config: DnsConfConfig,
  options: { retainCredentials?: boolean } = {}
): DnsConfPayload {
  const parsed = options.retainCredentials
    ? retainedCredentialsConfigSchema.parse(config)
    : dnsConfConfigSchema.parse(config);

  return {
    secrets: options.retainCredentials ? {} : {
      CLIENT_ID: parsed.profiles.map(p => p.clientId).join(","),
      AUTH_SECRET: parsed.profiles.map(p => p.authSecret).join(",")
    },
    variables: {
      DNS: parsed.profiles.map(p => p.provider || "cloudflare").join(","),
      DONOR_DNS: parsed.profiles.map(p => p.donorDns || DISABLED_DNS_DONOR).join(","),
      BLOCK: parsed.blocklists.join(","),
      REDIRECT: parsed.redirects.join(","),
      EXCLUDE_REDIRECT: parsed.redirectExclusions.join(",")
    }
  };
}

function isValidDonorDns(value: string): boolean {
  if (isValidIpv4(value)) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255 && String(number) === part;
  });
}

export function getWizardStepValidity(step: number, config: Partial<DnsConfConfig>): boolean {
  switch (step) {
    case 1:
      return (config.profiles ?? []).some(p => dnsProviderSchema.safeParse(p.provider).success);
    case 2:
      return (config.profiles ?? []).length > 0 && (config.profiles ?? []).every(p => p.clientId?.trim() && p.authSecret?.trim());
    case 3:
      return z.array(z.string().trim().url()).safeParse(config.blocklists ?? []).success;
    case 4:
      return z
        .object({
          redirects: z.array(z.string().trim().url()),
          redirectExclusions: z.array(z.string().trim().min(1))
        })
        .partial()
        .safeParse(config).success;
    case 5:
    case 6:
      return dnsConfConfigSchema.safeParse(config).success;
    default:
      return false;
  }
}

export const dnsConfWorkflow = {
  sourceOwner: "noVibe",
  sourceRepo: "DnsConf",
  workflowFileName: "github_action.yml"
} as const;
