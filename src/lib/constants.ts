export const CLOUDFLARE_CLIENT_ID_LENGTH = 32;
export const NEXTDNS_CLIENT_ID_LENGTH = 6;

export const PROVIDER_DETECTION = {
  [CLOUDFLARE_CLIENT_ID_LENGTH]: "cloudflare",
  [NEXTDNS_CLIENT_ID_LENGTH]: "nextdns",
} as const;
