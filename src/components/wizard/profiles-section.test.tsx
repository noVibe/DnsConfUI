import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DEFAULT_DNS_DONOR } from "@/domain/dns-donors";
import { LocaleProvider } from "@/lib/i18n/context";
import { ProfilesSection } from "./profiles-section";

const apiMocks = vi.hoisted(() => ({ validateCredentials: vi.fn() }));

vi.mock("@/lib/nextdns/api", () => ({ validateCredentials: apiMocks.validateCredentials }));

const profile = {
  clientId: "",
  authSecret: "",
  provider: "" as const,
  donorDns: DEFAULT_DNS_DONOR,
};

function renderSection(overrides: Partial<React.ComponentProps<typeof ProfilesSection>> = {}) {
  const setValue = vi.fn();
  const props: React.ComponentProps<typeof ProfilesSection> = {
    profiles: [profile],
    setValue: setValue as React.ComponentProps<typeof ProfilesSection>["setValue"],
    simplified: true,
    ...overrides,
  };

  render(
    <LocaleProvider>
      <ProfilesSection {...props} />
    </LocaleProvider>,
  );

  return { setValue };
}

function ControlledValidationSection() {
  const [profiles, setProfiles] = useState([{ clientId: "abc123", authSecret: "secret", provider: "nextdns" as const, donorDns: DEFAULT_DNS_DONOR }]);
  const setValue = (_name: "profiles", value: typeof profiles) => setProfiles(value);

  return (
    <LocaleProvider>
      <ProfilesSection
        profiles={profiles}
        setValue={setValue as React.ComponentProps<typeof ProfilesSection>["setValue"]}
        simplified
      />
    </LocaleProvider>
  );
}

describe("ProfilesSection", () => {
  afterEach(() => {
    vi.useRealTimers();
    apiMocks.validateCredentials.mockReset();
  });

  it("shows the default DNS donor preset", () => {
    renderSection();

    expect(screen.getByRole("checkbox", { name: "DNS-донор" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "DNS-донор" })).toHaveValue(DEFAULT_DNS_DONOR);
  });

  it("disables the donor without changing other profile fields", () => {
    const { setValue } = renderSection();

    fireEvent.click(screen.getByRole("checkbox", { name: "DNS-донор" }));

    expect(setValue).toHaveBeenCalledWith("profiles", [{ ...profile, donorDns: "" }], {
      shouldDirty: true,
      shouldValidate: true,
    });
  });

  it("selects another donor preset", () => {
    const { setValue } = renderSection();

    fireEvent.change(screen.getByRole("combobox", { name: "DNS-донор" }), {
      target: { value: "https://xbox-dns.ru/dns-query" },
    });

    expect(setValue).toHaveBeenCalledWith(
      "profiles",
      [{ ...profile, donorDns: "https://xbox-dns.ru/dns-query" }],
      { shouldDirty: true, shouldValidate: true },
    );
  });

  it("adds a profile with the default donor", () => {
    const { setValue } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Добавить профиль" }));

    expect(setValue).toHaveBeenCalledWith(
      "profiles",
      [profile, { clientId: "", authSecret: "", provider: "", donorDns: DEFAULT_DNS_DONOR }],
      { shouldDirty: true, shouldValidate: true },
    );
  });

  it("replaces the last removed profile with a fresh default profile", () => {
    const { setValue } = renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Удалить профиль" }));

    expect(setValue).toHaveBeenCalledWith(
      "profiles",
      [{ clientId: "", authSecret: "", provider: "", donorDns: DEFAULT_DNS_DONOR }],
      { shouldDirty: true, shouldValidate: true },
    );
  });

  it("keeps a custom donor available in expert mode", () => {
    renderSection({ profiles: [{ ...profile, donorDns: "1.1.1.1" }], simplified: false });

    expect(screen.getByPlaceholderText("IPv4-адрес или DoH URL")).toHaveValue("1.1.1.1");
  });

  it("validates complete credentials after the debounce delay", async () => {
    vi.useFakeTimers();
    apiMocks.validateCredentials.mockResolvedValue({ valid: true });
    const onValidChange = vi.fn();

    renderSection({
      profiles: [{ clientId: "abc123", authSecret: "secret", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR }],
      onValidChange,
    });

    expect(apiMocks.validateCredentials).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(apiMocks.validateCredentials).toHaveBeenCalledWith("abc123", "secret", "nextdns");
    expect(screen.getByText("Учётные данные подтверждены")).toBeInTheDocument();
    expect(onValidChange).toHaveBeenLastCalledWith(true);
  });

  it("ignores a stale credential validation response", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (result: { valid: false; error: string }) => void;
    let resolveSecond!: (result: { valid: true }) => void;
    apiMocks.validateCredentials
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    render(<ControlledValidationSection />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(apiMocks.validateCredentials).toHaveBeenCalledWith("abc123", "secret", "nextdns");

    fireEvent.change(screen.getByRole("textbox", { name: /CLIENT_ID/ }), { target: { value: "def456" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(apiMocks.validateCredentials).toHaveBeenCalledWith("def456", "secret", "nextdns");

    await act(async () => { resolveSecond({ valid: true }); await Promise.resolve(); });
    expect(screen.getByText("Учётные данные подтверждены")).toBeInTheDocument();

    await act(async () => { resolveFirst({ valid: false, error: "Old credentials" }); await Promise.resolve(); });
    expect(screen.getByText("Учётные данные подтверждены")).toBeInTheDocument();
    expect(screen.queryByText("Old credentials")).not.toBeInTheDocument();
  });
});
