import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/context";
import { ProvisionPanel } from "./provision-panel";

function renderPanel({ retainCredentials = false, status = "idle" }: {
  retainCredentials?: boolean;
  status?: "idle" | "running" | "done" | "error";
} = {}) {
  render(
    <LocaleProvider>
      <ProvisionPanel
        status={status}
        message=""
        result={null}
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

    expect(screen.getByRole("button", { name: "Обновление…" })).toHaveClass("whitespace-nowrap");
  });

  it("keeps apply copy for a full configuration", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Применить конфигурацию" })).toBeVisible();
  });
});
