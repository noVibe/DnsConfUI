import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DNS_DONORS } from "@/domain/dns-donors";
import { LocaleProvider } from "@/lib/i18n/context";
import { CustomDonorsProvider } from "@/components/wizard/custom-donors";
import { HiddenDonorsProvider } from "@/components/wizard/hidden-donors";
import { DnsMonitor } from "./dns-monitor";

const checkDonor = vi.hoisted(() => vi.fn());
const visitorCountry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/dns/donor-check", () => ({ checkDonor, visitorCountry }));

function renderMonitor() {
  render(
    <LocaleProvider>
      <CustomDonorsProvider>
        <HiddenDonorsProvider>
          <DnsMonitor />
        </HiddenDonorsProvider>
      </CustomDonorsProvider>
    </LocaleProvider>
  );
}

describe("DnsMonitor", () => {
  beforeEach(() => {
    // The hidden servers are remembered in this browser, and jsdom's is shared by every test in the file.
    window.localStorage.clear();
    checkDonor.mockReset();
    checkDonor.mockResolvedValue({ dnsMs: 90, chatgptMs: 300, country: "NL", direct: false });
    visitorCountry.mockReset();
    visitorCountry.mockResolvedValue("UZ");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers to keep a DoH that answers and lists it under the name it is given", async () => {
    const kept: { label: string; value: string }[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const { url, label } = JSON.parse(String(init.body)) as { url: string; label: string };
        kept.push({ label, value: url });
      }
      return { ok: true, status: 200, json: async () => ({ donors: kept }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    renderMonitor();

    fireEvent.change(screen.getByRole("textbox", { name: "Проверить свой DoH" }), {
      target: { value: "https://dns.example.net/dns-query" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));

    // The offer waits for the check: there is no point keeping a server that does not answer.
    expect(await screen.findByText("Отвечает. Оставить его в списке?")).toBeInTheDocument();
    const name = screen.getByRole("textbox", { name: "Название для списка" });
    expect(name).toHaveValue("dns.example.net");
    fireEvent.change(name, { target: { value: "Мой DoH" } });
    fireEvent.click(screen.getByRole("button", { name: "Оставить" }));

    // It leaves the "custom" line and joins the table proper, under its own name.
    expect(await screen.findByRole("row", { name: /Мой DoH/ })).toBeInTheDocument();
    expect(screen.queryByText("Отвечает. Оставить его в списке?")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/donors/custom", expect.objectContaining({ method: "POST" }));
  });

  it("hides a row on request and brings it back through the column's own eye", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ donors: [] }) } as Response)));
    renderMonitor();
    const rows = () => screen.getAllByRole("row").length;
    const before = rows();

    fireEvent.click(screen.getByRole("button", { name: "Скрыть Comss" }));

    expect(rows()).toBe(before - 1);
    expect(screen.queryByRole("link", { name: "Comss" })).not.toBeInTheDocument();
    // The header eye says how many are gone and what pressing it does.
    const eye = screen.getByRole("button", { name: "Скрыто сервисов: 1. Нажмите, чтобы показать их" });

    fireEvent.click(eye);

    expect(rows()).toBe(before);
    expect(screen.getByRole("link", { name: "Comss" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Показать Comss" }));

    // Back in the table for good: with nothing hidden, the eye has nothing left to say.
    expect(screen.getByRole("button", { name: "Скрытых сервисов нет" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Comss" })).toBeInTheDocument();
  });

  it("takes a kept DoH back out of the table", async () => {
    const kept: { label: string; value: string }[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { url: string; label?: string }) : null;
      if (init?.method === "POST" && body) kept.push({ label: body.label ?? "", value: body.url });
      if (init?.method === "DELETE" && body) {
        const index = kept.findIndex((donor) => donor.value === body.url);
        if (index >= 0) kept.splice(index, 1);
      }
      return { ok: true, status: 200, json: async () => ({ donors: kept }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    renderMonitor();

    fireEvent.change(screen.getByRole("textbox", { name: "Проверить свой DoH" }), {
      target: { value: "https://dns.example.net/dns-query" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));
    await screen.findByText("Отвечает. Оставить его в списке?");
    fireEvent.change(screen.getByRole("textbox", { name: "Название для списка" }), { target: { value: "Мой DoH" } });
    fireEvent.click(screen.getByRole("button", { name: "Оставить" }));
    await screen.findByRole("row", { name: /Мой DoH/ });

    fireEvent.click(screen.getByRole("button", { name: "Удалить Мой DoH из таблицы" }));

    await waitFor(() => expect(screen.queryByRole("row", { name: /Мой DoH/ })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/donors/custom", expect.objectContaining({ method: "DELETE" }));
    // A preset has no such button: nothing on this page could put it back. It can still be hidden.
    expect(screen.queryByRole("button", { name: "Удалить Comss из таблицы" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Скрыть Comss" })).toBeInTheDocument();
  });

  it("does not offer to keep a DoH that fails", async () => {
    checkDonor.mockResolvedValue({ dnsMs: null, chatgptMs: null, country: null, direct: false });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ donors: [] }) } as Response)));
    renderMonitor();

    fireEvent.change(screen.getByRole("textbox", { name: "Проверить свой DoH" }), {
      target: { value: "https://dns.example.net/dns-query" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));

    await screen.findByText("свой");
    expect(screen.queryByText("Отвечает. Оставить его в списке?")).not.toBeInTheDocument();
  });

  it.each([
    ["UZ", "ChatGPT: без прокси, напрямую из UZ, 60 мс"],
    ["RU", "ChatGPT: без прокси, а из RU он не работает"]
  ])("shows the visitor's own country %s for a DNS without a proxy", async (country, text) => {
    visitorCountry.mockResolvedValue(country);
    checkDonor.mockImplementation(async (donor: string) => (donor === DNS_DONORS[0].value
      ? { dnsMs: 50, chatgptMs: 60, country: null, direct: true }
      : { dnsMs: 90, chatgptMs: 300, country: "NL", direct: false }));
    renderMonitor();

    const row = await screen.findByRole("row", { name: new RegExp(DNS_DONORS[0].label) });
    expect(await within(row).findByText(text)).toBeInTheDocument();
  });

  it("checks every donor and links each one to its site", async () => {
    renderMonitor();

    const row = (await screen.findAllByRole("row", { name: /ChatGPT: открывается через NL, 300 мс/ }))[0];
    expect(within(row).getByRole("link", { name: "GeoHide RU" })).toHaveAttribute("href", "https://geohide.ru");
    expect(within(row).getByText("DNS: отвечает, 90 мс")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(DNS_DONORS.length + 1);
    expect(screen.getByRole("link", { name: "DNS-AI" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Comss" })).toHaveAttribute("href", "https://www.comss.ru/page.php?id=7315");
  });

  it("checks again on request and blocks the button while checking", async () => {
    renderMonitor();
    const button = screen.getByRole("button", { name: "Проверить снова" });
    expect(button).toBeDisabled();

    await screen.findAllByText("DNS: отвечает, 90 мс");
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(checkDonor).toHaveBeenCalledTimes(DNS_DONORS.length * 2);
  });

  it("explains an address that is not an HTTPS URL", () => {
    renderMonitor();
    const input = screen.getByRole("textbox", { name: "Проверить свой DoH" });

    fireEvent.change(input, { target: { value: "http://dns.example/dns-query" } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Введите адрес DoH вида https://example.com/dns-query");
    expect(checkDonor).toHaveBeenCalledTimes(DNS_DONORS.length);
  });

  it("checks a custom DoH, rechecks it with the presets and removes it", async () => {
    const custom = "https://dns.example/dns-query";
    renderMonitor();

    fireEvent.change(screen.getByRole("textbox", { name: "Проверить свой DoH" }), { target: { value: ` ${custom} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));

    expect(checkDonor).toHaveBeenLastCalledWith(custom);
    const row = await screen.findByRole("row", { name: /dns\.example/ });
    expect(within(row).getByText("ChatGPT: открывается через NL, 300 мс")).toBeInTheDocument();

    await screen.findAllByText("DNS: отвечает, 90 мс");
    fireEvent.click(screen.getByRole("button", { name: "Проверить снова" }));
    expect(checkDonor).toHaveBeenCalledTimes(DNS_DONORS.length * 2 + 2);

    fireEvent.click(within(row).getByRole("button", { name: "Убрать свой DoH" }));
    expect(screen.queryByRole("row", { name: /dns\.example/ })).not.toBeInTheDocument();
  });

  it("treats an address without a scheme as HTTPS", () => {
    renderMonitor();

    fireEvent.change(screen.getByRole("textbox", { name: "Проверить свой DoH" }), { target: { value: "dns.example/dns-query" } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));

    expect(checkDonor).toHaveBeenLastCalledWith("https://dns.example/dns-query");
  });

  it("rechecks a preset in place instead of adding it twice", async () => {
    renderMonitor();
    // A preset that is still being checked is not checked again, so the first round has to finish.
    await screen.findAllByText("DNS: отвечает, 90 мс");
    checkDonor.mockClear();

    fireEvent.change(screen.getByRole("textbox", { name: "Проверить свой DoH" }), { target: { value: DNS_DONORS[0].value } });
    fireEvent.click(screen.getByRole("button", { name: "Проверить" }));

    expect(screen.getAllByRole("row")).toHaveLength(DNS_DONORS.length + 1);
    expect(checkDonor).toHaveBeenCalledTimes(1);
    expect(checkDonor).toHaveBeenLastCalledWith(DNS_DONORS[0].value);
  });
});
