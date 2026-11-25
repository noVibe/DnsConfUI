import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "AdGuard — DnsConf",
  description: "Dynamic $dnsrewrite filter lists for AdGuard Android, iOS, Windows, macOS and AdGuard Home"
};

export default function AdGuardLayout({ children }: { children: ReactNode }) {
  return children;
}
