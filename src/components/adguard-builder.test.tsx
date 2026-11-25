import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/context";
import { AdGuardBuilder } from "./adguard-builder";

const checkDonor = vi.hoisted(() => vi.fn());
const visitorCountry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/dns/donor-check", () => ({ checkDonor, visitorCountry }));

function renderBuilder() {
  render(
    <LocaleProvider>
      <AdGuardBuilder />
    </LocaleProvider>
  );
}

describe("AdGuardBuilder", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    checkDonor.mockReset().mockResolvedValue({ dnsMs: 40, chatgptMs: 120, country: "DE", direct: false, ips: ["198.51.100.1"] });
    visitorCountry.mockReset().mockResolvedValue("UZ");
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/adguard/status") {
        return new Response(
          JSON.stringify({
            donors: [
              { slug: "geohide-ru", label: "GeoHide RU", status: "ok", updatedAt: "2026-11-24T18:00:00Z", domainsCount: 402, rulesCount: 1608 },
              { slug: "comss", label: "Comss", status: "ok", updatedAt: "2026-11-24T18:00:00Z", domainsCount: 402, rulesCount: 403 }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("! Title: Test\n||chatgpt.com^$dnsrewrite=8.6.112.0\n", {
        status: 200,
        headers: { "Content-Type": "text/plain", "X-Rules-Count": "1", "X-Domains-Count": "1" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("generates clean /adguard/<slug> URLs, extracts hostnames from pasted URLs, and skips invalid exclusions", () => {
    renderBuilder();

    expect(screen.getByText(`${window.location.origin}/adguard/geohide-ru`)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Сканировать с телефона" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Comss/ }));
    expect(screen.getByText(`${window.location.origin}/adguard/comss`)).toBeInTheDocument();

    // Toggle options: max IPs = 1, paste a full URL and an invalid token
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.change(screen.getByPlaceholderText(/instagram\.com/), {
      target: { value: "https://instagram.com/reels\nnotadomain" }
    });

    expect(
      screen.getByText(`${window.location.origin}/adguard/comss?exclude=instagram.com&ips=1`)
    ).toBeInTheDocument();
    expect(screen.getByText(/Пропущены некорректные записи: notadomain/)).toBeInTheDocument();
  });

  it("hides subdomain compression toggle and omits compress param when exact mode is selected", () => {
    renderBuilder();

    expect(screen.getByText("Компрессия поддоменов")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Только точный домен/ }));

    expect(screen.queryByText("Компрессия поддоменов")).not.toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/adguard/geohide-ru?mode=exact`)).toBeInTheDocument();
  });

  it("re-fetches /api/adguard/status when Refresh is clicked", async () => {
    renderBuilder();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/adguard/status", expect.anything());
    });
    const initialCalls = fetchMock.mock.calls.filter(([u]) => u === "/api/adguard/status").length;

    const refreshBtn = screen.getByRole("button", { name: "Проверить снова" });
    await waitFor(() => expect(refreshBtn).not.toBeDisabled());
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      const nextCalls = fetchMock.mock.calls.filter(([u]) => u === "/api/adguard/status").length;
      expect(nextCalls).toBeGreaterThan(initialCalls);
    });
  });

  it("switches platform setup instructions in the tabpanel including iOS AdGuard DNS implementation note", () => {
    renderBuilder();

    fireEvent.click(screen.getByRole("tab", { name: "iOS" }));
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent(/Реализация DNS → выберите «AdGuard»/);

    fireEvent.click(screen.getByRole("tab", { name: "Роутер (AdGuard Home)" }));
    expect(panel).toHaveTextContent(/Чёрные списки DNS/);
  });
});
