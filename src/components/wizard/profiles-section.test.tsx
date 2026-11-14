import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DEFAULT_DNS_DONOR } from "@/domain/dns-donors";
import { LocaleProvider } from "@/lib/i18n/context";
import { DonorChecksProvider } from "./donor-checks";
import { ProfilesSection } from "./profiles-section";

const apiMocks = vi.hoisted(() => ({ validateCredentials: vi.fn() }));

vi.mock("@/lib/nextdns/api", () => ({ validateCredentials: apiMocks.validateCredentials }));

vi.mock("@/lib/dns/donor-check", () => ({ checkDonor: () => new Promise(() => {}), visitorCountry: () => new Promise(() => {}) }));

/** What the section needs around it: the language, and the one round of donor checks the page shares. */
function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <DonorChecksProvider>{children}</DonorChecksProvider>
    </LocaleProvider>
  );
}

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
    <Providers>
      <ProfilesSection {...props} />
    </Providers>,
  );

  return { setValue };
}

function ControlledValidationSection() {
  const [profiles, setProfiles] = useState([{ clientId: "abc123", authSecret: "secret", provider: "nextdns" as const, donorDns: DEFAULT_DNS_DONOR }]);
  const setValue = (_name: "profiles", value: typeof profiles) => setProfiles(value);

  return (
    <Providers>
      <ProfilesSection
        profiles={profiles}
        setValue={setValue as React.ComponentProps<typeof ProfilesSection>["setValue"]}
        simplified
      />
    </Providers>
  );
}

function ControlledProfilesSection({ initial, onValidChange }: {
  initial: React.ComponentProps<typeof ProfilesSection>["profiles"];
  onValidChange: (valid: boolean) => void;
}) {
  const [profiles, setProfiles] = useState(initial);
  const setValue = (_name: "profiles", value: typeof profiles) => setProfiles(value);

  return (
    <Providers>
      <ProfilesSection
        profiles={profiles}
        setValue={setValue as React.ComponentProps<typeof ProfilesSection>["setValue"]}
        simplified
        onValidChange={onValidChange}
      />
    </Providers>
  );
}

function ControlledDonorSection({ donorDns }: { donorDns: string }) {
  const [profiles, setProfiles] = useState([{ clientId: "", authSecret: "", provider: "nextdns" as const, donorDns }]);
  const setValue = (_name: "profiles", value: typeof profiles) => setProfiles(value);

  return (
    <Providers>
      <ProfilesSection
        profiles={profiles}
        setValue={setValue as React.ComponentProps<typeof ProfilesSection>["setValue"]}
        simplified
        retainCredentials
      />
    </Providers>
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
    expect(screen.getByText("DNS-донор", { selector: "label" })).toHaveClass("whitespace-nowrap");
    expect(screen.getByRole("combobox", { name: "DNS-донор" })).toHaveAttribute("title", DEFAULT_DNS_DONOR);
    expect(screen.getByRole("combobox", { name: "DNS-донор" })).toHaveAttribute("title", DEFAULT_DNS_DONOR);
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

    fireEvent.click(screen.getByRole("combobox", { name: "DNS-донор" }));
    fireEvent.click(screen.getByRole("option", { name: /^GeoHide EU./ }));

    expect(setValue).toHaveBeenCalledWith(
      "profiles",
      [{ ...profile, donorDns: "https://eu.geohide.ru/dns-query" }],
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

  it("shows retained profiles without exposing credential or profile controls", () => {
    renderSection({
      profiles: [
        { clientId: "", authSecret: "", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR },
        { clientId: "", authSecret: "", provider: "cloudflare", donorDns: "" }
      ],
      retainCredentials: true
    });

    expect(screen.queryByRole("button", { name: "Добавить профиль" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Удалить профиль" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /CLIENT_ID/ })).not.toBeInTheDocument();
    expect(screen.getByText("DNS: NextDNS")).toBeVisible();
    expect(screen.getByText("CLIENT_ID и AUTH_SECRET — без изменений.")).toBeVisible();

    fireEvent.change(screen.getByRole("combobox", { name: "Выбрать профиль" }), { target: { value: "1" } });
    expect(screen.getByText("DNS: Cloudflare")).toBeVisible();
  });

  it("restores the DNS donor selected for every retained profile", () => {
    renderSection({
      profiles: [
        { clientId: "", authSecret: "", provider: "nextdns", donorDns: "https://eu.geohide.ru/dns-query" },
        { clientId: "", authSecret: "", provider: "nextdns", donorDns: "https://dns.comss.one/dns-query" },
        { clientId: "", authSecret: "", provider: "nextdns", donorDns: "https://custom.test/dns-query" },
        { clientId: "", authSecret: "", provider: "nextdns", donorDns: "" }
      ],
      retainCredentials: true
    });

    expect(screen.getByRole("combobox", { name: "DNS-донор" })).toHaveAttribute("title", "https://eu.geohide.ru/dns-query");

    fireEvent.change(screen.getByRole("combobox", { name: "Выбрать профиль" }), { target: { value: "1" } });
    expect(screen.getByRole("combobox", { name: "DNS-донор" })).toHaveAttribute("title", "https://dns.comss.one/dns-query");

    fireEvent.change(screen.getByRole("combobox", { name: "Выбрать профиль" }), { target: { value: "2" } });
    expect(screen.getByRole("combobox", { name: "DNS-донор" }))
      .toHaveTextContent("Свой адрес: https://custom.test/dns-query");

    fireEvent.change(screen.getByRole("combobox", { name: "Выбрать профиль" }), { target: { value: "3" } });
    expect(screen.getByRole("checkbox", { name: "DNS-донор" })).not.toBeChecked();
    expect(screen.queryByRole("combobox", { name: "DNS-донор" })).not.toBeInTheDocument();
  });

  it("restores a custom donor after disabling and enabling it in retained setup", () => {
    const customDonor = "https://custom.test/dns-query";
    render(<ControlledDonorSection donorDns={customDonor} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "DNS-донор" }));
    expect(screen.queryByRole("combobox", { name: "DNS-донор" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "DNS-донор" }));
    expect(screen.getByRole("combobox", { name: "DNS-донор" })).toHaveAttribute("title", customDonor);
    expect(screen.getByRole("combobox", { name: "DNS-донор" }))
      .toHaveTextContent(`Свой адрес: ${customDonor}`);
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

  it("keeps each validation result with its profile after another profile is removed", async () => {
    vi.useFakeTimers();
    apiMocks.validateCredentials.mockImplementation(async (clientId: string) =>
      clientId === "abc123" ? { valid: true } : { valid: false, error: "Wrong key" });
    const onValidChange = vi.fn();

    render(
      <ControlledProfilesSection
        initial={[
          { clientId: "abc123", authSecret: "secret", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR },
          { clientId: "def456", authSecret: "secret", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR }
        ]}
        onValidChange={onValidChange}
      />
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    fireEvent.change(screen.getByRole("combobox", { name: "Выбрать профиль" }), { target: { value: "1" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText("Wrong key")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Выбрать профиль" }), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Удалить профиль" }));

    expect(screen.getByText("Wrong key")).toBeInTheDocument();
    expect(onValidChange).toHaveBeenLastCalledWith(false);
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
