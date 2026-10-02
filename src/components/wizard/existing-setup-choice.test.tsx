import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DNS_DONOR } from "@/domain/dns-donors";
import { LocaleProvider } from "@/lib/i18n/context";
import { ExistingSetupChoice } from "./existing-setup-choice";

const setup = {
  repository: { owner: "alice", repo: "DnsConf" },
  variables: { DNS: "nextdns" },
  config: {
    profiles: [{ clientId: "", authSecret: "", provider: "nextdns" as const, donorDns: DEFAULT_DNS_DONOR }],
    blocklists: [],
    redirects: [],
    redirectExclusions: []
  }
};

function renderChoice(overrides: Partial<React.ComponentProps<typeof ExistingSetupChoice>> = {}) {
  const props: React.ComponentProps<typeof ExistingSetupChoice> = {
    loading: false,
    error: "",
    setup,
    onRetry: vi.fn(),
    onConfigureFromScratch: vi.fn(),
    onRetainCredentials: vi.fn(),
    ...overrides
  };
  render(<LocaleProvider><ExistingSetupChoice {...props} /></LocaleProvider>);
  return props;
}

describe("ExistingSetupChoice", () => {
  it("offers fresh setup or retaining GitHub credentials", () => {
    const props = renderChoice();

    expect(screen.getByText(/alice\/DnsConf/)).toBeVisible();
    for (const description of [
      screen.getByText(/Снова указать ID профилей/),
      screen.getByText(/Оставить CLIENT_ID и AUTH_SECRET/)
    ]) {
      expect(description).toHaveClass("mt-3", "rounded-md", "border", "bg-white/50", "px-3", "py-2");
    }
    fireEvent.click(screen.getByRole("button", { name: /Настроить всё заново/ }));
    fireEvent.click(screen.getByRole("button", { name: /Сохранить учётные данные/ }));
    expect(props.onConfigureFromScratch).toHaveBeenCalledOnce();
    expect(props.onRetainCredentials).toHaveBeenCalledOnce();
  });

  it("disables credential retention when DNS cannot restore the profile layout", () => {
    renderChoice({ setup: { ...setup, config: null } });

    expect(screen.getByRole("button", { name: /Сохранить учётные данные/ })).toBeDisabled();
    expect(screen.getByText(/Переменная DNS отсутствует/)).toBeVisible();
  });

  it("allows retrying a failed GitHub lookup", () => {
    const props = renderChoice({ setup: null, error: "GitHub unavailable" });

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });
});

describe("ExistingSetupChoice with a disabled workflow", () => {
  it("offers to turn the updates back on", () => {
    const onEnableWorkflow = vi.fn();
    renderChoice({
      setup: { ...setup, workflow: { disabled: true, lastRunAt: "2026-07-28T04:41:10Z" } },
      onEnableWorkflow
    });

    const button = screen.getByRole("button", { name: /Включить обновление правил/ });
    expect(screen.getByText(/Последнее обновление правил/)).toBeVisible();

    fireEvent.click(button);
    expect(onEnableWorkflow).toHaveBeenCalled();
  });

  it("stays hidden while the workflow is active", () => {
    renderChoice({ setup: { ...setup, workflow: { disabled: false } } });

    expect(screen.queryByText(/Включить обновление правил/)).toBeNull();
  });
});
