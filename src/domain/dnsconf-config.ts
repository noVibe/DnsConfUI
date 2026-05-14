import { z } from "zod";

export const dnsProviderSchema = z.enum(["cloudflare", "nextdns"]);

export const profileSchema = z.object({
  clientId: z.string().trim().min(1, "Client identifier is required"),
  authSecret: z.string().trim().min(1, "Provider API secret is required"),
  provider: dnsProviderSchema.or(z.literal(""))
});

export const dnsConfConfigSchema = z
  .object({
    profiles: z.array(profileSchema).min(1),
    blocklists: z.array(z.string().trim().url("Enter a valid URL")).default([]),
    redirects: z.array(z.string().trim().url("Enter a valid URL")).default([]),
    redirectExclusions: z.array(z.string().trim().min(1, "Enter a domain name").refine(v => !v.includes("://"), "Use a domain name, not a URL")).default([])
  })
  .superRefine((data, ctx) => {
    for (const [index, profile] of data.profiles.entries()) {
      const len = profile.clientId.length;
      if (len === 0) continue;
      const expected = profile.provider === "nextdns" ? 6 : 32;
      if (len !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profiles", index, "clientId"],
          message: "DNS Client ID must be:\n6 characters (NextDNS)\n32 characters (Cloudflare)"
        });
      }
    }
  });

export type DnsConfConfig = z.infer<typeof dnsConfConfigSchema>;

export type Profile = z.infer<typeof profileSchema>;

export type DnsConfPayload = {
  secrets: Record<"CLIENT_ID" | "AUTH_SECRET", string>;
  variables: Record<"DNS" | "BLOCK" | "REDIRECT" | "EXCLUDE_REDIRECT", string>;
};

export const defaultDnsConfConfig: DnsConfConfig = {
  profiles: [{ clientId: "", authSecret: "", provider: "" }],
  blocklists: [],
  redirects: [],
  redirectExclusions: []
};

export function buildDnsConfPayload(config: DnsConfConfig): DnsConfPayload {
  const parsed = dnsConfConfigSchema.parse(config);

  return {
    secrets: {
      CLIENT_ID: parsed.profiles.map(p => p.clientId).join(","),
      AUTH_SECRET: parsed.profiles.map(p => p.authSecret).join(",")
    },
    variables: {
      DNS: parsed.profiles.map(p => p.provider || "cloudflare").join(","),
      BLOCK: parsed.blocklists.join(","),
      REDIRECT: parsed.redirects.join(","),
      EXCLUDE_REDIRECT: parsed.redirectExclusions.join(",")
    }
  };
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
