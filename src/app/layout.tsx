import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { LocaleProvider } from "@/lib/i18n/context";
import { ThemeProvider } from "@/lib/theme/context";

export const metadata: Metadata = {
  title: "DnsConf",
  description: "noVibe/DnsConf onboarding UI"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <AuthProvider>
          <ThemeProvider>
            <LocaleProvider>{children}</LocaleProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
