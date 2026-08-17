import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/context";
import type { ProvisionResult } from "@/lib/github/provisioning";
import { ProvisionPanel } from "./provision-panel";

function renderPanel({ retainCredentials = false, status = "idle", result = null }: {
  retainCredentials?: boolean;
  status?: "idle" | "running" | "done" | "error";
  result?: ProvisionResult | null;
} = {}) {
  render(
    <LocaleProvider>
      <ProvisionPanel
        status={status}
        message=""
        result={result}
        onProvision={vi.fn()}
        disabled={false}
        starred={false}
        starring={false}
        onStar={vi.fn().mockResolvedValue(undefined)}
        retainCredentials={retainCredentials}
      />
    </LocaleProvider>,
  );
}

describe("ProvisionPanel", () => {
  it("uses update copy when credentials are retained", () => {
    renderPanel({ retainCredentials: true });

    expect(screen.getByText("Применить изменения")).toBeVisible();
    expect(screen.getByRole("button", { name: "Обновить конфигурацию" })).toBeVisible();
  });

  it("uses update progress copy when retained configuration is running", () => {
    renderPanel({ retainCredentials: true, status: "running" });

    expect(screen.getByRole("button", { name: "Обновление конфигурации…" }))
      .toHaveClass("whitespace-nowrap", "text-xs");
  });

  it("links to a workflow run while configuration is still updating", () => {
    renderPanel({
      retainCredentials: true,
      status: "running",
      result: {
        repository: { owner: "alice", repo: "DnsConf" },
        workflowRunUrl: "https://github.com/alice/DnsConf/actions/runs/7",
        workflowRunId: 7
      }
    });

    expect(screen.getByRole("link", { name: "Открыть запуск workflow" })).toHaveAttribute(
      "href",
      "https://github.com/alice/DnsConf/actions/runs/7"
    );
  });

  it("keeps apply copy for a full configuration", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Применить конфигурацию" })).toBeVisible();
  });
});
