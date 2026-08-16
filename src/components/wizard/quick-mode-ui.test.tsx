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
    providerValue: "nextdns",
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
    syncing: false,
    synced: false,
    needsSync: false,
    onSync: vi.fn().mockResolvedValue(undefined),
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
});
