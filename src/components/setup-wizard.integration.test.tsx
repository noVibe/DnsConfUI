import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DNS_DONOR } from "@/domain/dns-donors";
import { GEOHIDE_HOSTS_LIST, MALW_HOSTS_LIST } from "@/domain/toggles";
import { LocaleProvider } from "@/lib/i18n/context";
import { SetupWizard } from "./setup-wizard";

const mocks = vi.hoisted(() => ({
  loadExistingDnsConfSetup: vi.fn()
}));

vi.mock("./auth-provider", () => ({
  useAuth: () => ({ token: "github-token" })
}));

vi.mock("@/lib/github/provisioning", () => ({
  createGitHubRequest: vi.fn(() => vi.fn()),
  loadExistingDnsConfSetup: mocks.loadExistingDnsConfSetup,
  provisionDnsConfRepository: vi.fn(),
  starRepository: vi.fn()
}));

describe("SetupWizard retained navigation", () => {
  beforeEach(() => {
    mocks.loadExistingDnsConfSetup.mockResolvedValue({
      repository: { owner: "alice", repo: "DnsConf" },
      variables: {
        DNS: "nextdns",
        DONOR_DNS: DEFAULT_DNS_DONOR,
        REDIRECT: GEOHIDE_HOSTS_LIST
      },
      config: {
        profiles: [{ clientId: "", authSecret: "", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR }],
        blocklists: [],
        redirects: [GEOHIDE_HOSTS_LIST],
        redirectExclusions: []
      },
      variableEnvironment: "dns"
    });
  });

  it("returns from full setup to the retained configuration", async () => {
    render(
      <LocaleProvider>
        <SetupWizard />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /Сохранить учётные данные/ }));
    const setupTitle = screen.getByRole("heading", { name: "Настройка конфигурации" });
    const quickModeButton = screen.getByRole("button", { name: "Быстрая" });
    expect(setupTitle.parentElement).toContainElement(quickModeButton);
    expect(setupTitle.parentElement).toHaveClass("flex-col", "sm:flex-row", "sm:justify-between");
    expect(quickModeButton.parentElement).toHaveClass("ml-auto");
    fireEvent.click(screen.getByRole("button", { name: "Перейти к полной настройке" }));

    const returnButton = screen.getByRole("button", {
      name: "Обратно к настройке без учётных данных"
    });
    expect(returnButton).toBeVisible();
    expect(returnButton.previousElementSibling).toHaveTextContent("Профили");

    fireEvent.click(returnButton);

    expect(screen.getByRole("button", { name: "Перейти к полной настройке" })).toBeVisible();
    expect(screen.queryByRole("button", {
      name: "Обратно к настройке без учётных данных"
    })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "DNS-донор" })).toHaveValue(DEFAULT_DNS_DONOR);
  });

  it("preserves every geo-blocking source after disabling and re-enabling the feature", async () => {
    const customRedirect = "https://custom.test/redirect-hosts.txt";
    mocks.loadExistingDnsConfSetup.mockResolvedValueOnce({
      repository: { owner: "alice", repo: "DnsConf" },
      variables: {
        DNS: "nextdns",
        DONOR_DNS: DEFAULT_DNS_DONOR,
        REDIRECT: [GEOHIDE_HOSTS_LIST, MALW_HOSTS_LIST, customRedirect].join(",")
      },
      config: {
        profiles: [{ clientId: "", authSecret: "", provider: "nextdns", donorDns: DEFAULT_DNS_DONOR }],
        blocklists: [],
        redirects: [GEOHIDE_HOSTS_LIST, MALW_HOSTS_LIST, customRedirect],
        redirectExclusions: []
      },
      variableEnvironment: "dns"
    });

    render(
      <LocaleProvider>
        <SetupWizard />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /Сохранить учётные данные/ }));

    const geoBlock = screen.getByRole("checkbox", { name: "Обход гео-блокировок" });
    const geoHide = screen.getByRole("checkbox", { name: "GeoHide" });
    const malw = screen.getByRole("checkbox", { name: "Malw" });
    const customSource = screen.getByRole("textbox", { name: "Другой источник перенаправлений 1" });

    expect(geoBlock).toBeChecked();
    expect(geoHide).toBeChecked();
    expect(malw).toBeChecked();
    expect(customSource).toHaveValue(customRedirect);

    fireEvent.click(geoBlock);
    expect(geoBlock).not.toBeChecked();
    expect(geoHide).toBeChecked();
    expect(malw).toBeChecked();
    expect(customSource).toHaveValue(customRedirect);

    fireEvent.click(geoBlock);
    expect(geoBlock).toBeChecked();
    expect(geoHide).toBeChecked();
    expect(malw).toBeChecked();
    expect(customSource).toHaveValue(customRedirect);
  });

  it("shows the DNS donor as disabled when DONOR_DNS is absent", async () => {
    mocks.loadExistingDnsConfSetup.mockResolvedValueOnce({
      repository: { owner: "alice", repo: "DnsConf" },
      variables: { DNS: "nextdns" },
      config: {
        profiles: [{ clientId: "", authSecret: "", provider: "nextdns", donorDns: "" }],
        blocklists: [],
        redirects: [],
        redirectExclusions: []
      },
      variableEnvironment: "dns"
    });

    render(
      <LocaleProvider>
        <SetupWizard />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /Сохранить учётные данные/ }));

    expect(screen.getByRole("checkbox", { name: "DNS-донор" })).not.toBeChecked();
    expect(screen.queryByRole("combobox", { name: "DNS-донор" })).not.toBeInTheDocument();
  });
});
