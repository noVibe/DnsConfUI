import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

function getLocalOrigins(): string[] {
  const origins: string[] = ["localhost", "127.0.0.1", "::1"];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        origins.push(net.address);
      }
    }
  }
  if (process.env.ALLOWED_DEV_ORIGINS) {
    origins.push(...process.env.ALLOWED_DEV_ORIGINS.split(","));
  }
  return origins;
}

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self' https://github.com https://api.github.com ws:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://github.com"
    ].join("; ")
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
];

const nextConfig: NextConfig = {
  allowedDevOrigins: isDev ? getLocalOrigins() : undefined,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
