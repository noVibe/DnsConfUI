import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DNS_DONOR } from "@/domain/dns-donors";
import { GEOHIDE_HOSTS_LIST } from "@/domain/toggles";
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
});
