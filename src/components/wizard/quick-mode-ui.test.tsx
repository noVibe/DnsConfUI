import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { DEFAULT_DNS_DONOR } from "@/domain/dns-donors";
import { LocaleProvider } from "@/lib/i18n/context";
import { QuickModeUI } from "./quick-mode-ui";

function renderQuickMode(overrides: Partial<ComponentProps<typeof QuickModeUI>> = {}) {
  const callbacks = {
    onGeoBlockChange: vi.fn(),
    onGeoHideChange: vi.fn(),
    onMalwChange: vi.fn(),
  };
  const props: ComponentProps<typeof QuickModeUI> = {
    mode: "quick",
    setMode: vi.fn(),
    profiles: [{ clientId: "abc123", authSecret: "secret", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR }],
    providerLabel: "NextDNS",
    setValue: vi.fn() as ComponentProps<typeof QuickModeUI>["setValue"],
    mixedProviderIndices: new Set(),
    geoBlock: false,
    geoHideChecked: true,
    malwChecked: true,
    blockAds: true,
    disguisedTrackers: true,
    nativeTracking: true,
    ...callbacks,
    onBlockAdsChange: vi.fn(),
    onDisguisedTrackersChange: vi.fn(),
    onNativeTrackingChange: vi.fn(),
    onProfilesValidChange: vi.fn(),
    onProvision: vi.fn(),
    status: "idle",
    message: "",
    disabled: false,
    quickSteps: [],
    result: null,
    starred: false,
    starring: false,
    onStar: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  render(<LocaleProvider><QuickModeUI {...props} /></LocaleProvider>);
  return callbacks;
}

describe("QuickModeUI", () => {
  it("keeps GeoHide and Malw visible when geo-blocking is disabled", () => {
    renderQuickMode();

    expect(screen.getByRole("checkbox", { name: "GeoHide" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Malw" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "GeoHide" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Malw" })).toBeChecked();
  });

  it("still allows a child source to re-enable geo-blocking through the parent callback", () => {
    const { onGeoHideChange } = renderQuickMode({ geoHideChecked: false });

    fireEvent.click(screen.getByRole("checkbox", { name: "GeoHide" }));

    expect(onGeoHideChange).toHaveBeenCalledWith(true);
  });

  it("moves unknown NextDNS API settings into a separate unavailable block", () => {
    const onConfigureFromScratch = vi.fn();
    renderQuickMode({
      retainCredentials: true,
      profiles: [{ clientId: "", authSecret: "", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR }],
      blockAds: false,
      disguisedTrackers: false,
      nativeTracking: false,
      onConfigureFromScratch
    });

    expect(screen.queryByRole("checkbox", { name: "Блокировка рекламы и трекеров" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Блокировка скрытых сторонних трекеров" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Защита от встроенного отслеживания" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Обход гео-блокировок" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Недоступно без учётных данных" })).toBeVisible();
    expect(screen.getByText(/Их текущее состояние неизвестно/)).toBeVisible();
    expect(screen.getByText("Блокировка рекламы и трекеров")).toBeVisible();
    expect(screen.getByText("Блокировка скрытых сторонних трекеров")).toBeVisible();
    expect(screen.getByText("Защита от встроенного отслеживания")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Перейти к полной настройке" }));
    expect(onConfigureFromScratch).toHaveBeenCalledOnce();
  });

  it("keeps repository-backed Cloudflare blocking editable in retained mode", () => {
    renderQuickMode({
      retainCredentials: true,
      profiles: [{ clientId: "", authSecret: "", provider: "cloudflare", donorDns: DEFAULT_DNS_DONOR }],
      blockAds: true
    });

    expect(screen.getByRole("checkbox", { name: "Блокировка рекламы и трекеров" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Недоступно без учётных данных" })).not.toBeInTheDocument();
  });

  it("shows unrecognized redirect URLs in retained mode even when geo-blocking is disabled", () => {
    renderQuickMode({
      retainCredentials: true,
      profiles: [{ clientId: "", authSecret: "", provider: "cloudflare", donorDns: DEFAULT_DNS_DONOR }],
      customRedirects: ["https://custom.test/one", "https://custom.test/two"]
    });

    expect(screen.getByRole("textbox", { name: "Другой источник перенаправлений 1" }))
      .toHaveValue("https://custom.test/one");
    expect(screen.getByRole("textbox", { name: "Другой источник перенаправлений 2" }))
      .toHaveValue("https://custom.test/two");
  });
});
