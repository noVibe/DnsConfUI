import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DNS_DONORS } from "@/domain/dns-donors";
import { applyOverrides, parseHosts } from "@/domain/hosts";
import { LocaleProvider } from "@/lib/i18n/context";
import { HostsBuilder } from "./hosts-builder";

const donorChecks = vi.hoisted(() => ({ checkDonor: vi.fn(), visitorCountry: vi.fn() }));

vi.mock("@/lib/dns/donor-check", () => donorChecks);

// The working tree is CRLF, so the fixture states its own line ending instead of inheriting the file's.
const CRLF = "\r\n";

/**
 * Two domains worth resolving (one of them pinned twice, as published lists do), a blocking entry that must
 * survive untouched, and a single-label name that is a legal entry but cannot be asked of a public resolver.
 */
const BASE =
  [
    "# base list",
    "1.1.1.1 a.example",
    "2.2.2.2 a.example",
    "3.3.3.3 b.example",
    "0.0.0.0 ads.example",
    "4.4.4.4 single"
  ].join(CRLF) + CRLF;

function manyHosts(count: number): string {
  return Array.from({ length: count }, (_, index) => `9.9.9.9 h${index}.example`).join(CRLF) + CRLF;
}

/** A stable fake answer per hostname, so a test can rebuild the file it expects to be offered. */
function ipFor(hostname: string): string {
  const sum = [...hostname].reduce((total, character) => total + character.charCodeAt(0), 0);
  return `10.0.0.${(sum % 250) + 1}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function resolveResponse(body: { donors: string[]; hostnames: string[] }): Response {
  return jsonResponse({
    results: body.hostnames.map((hostname) => ({ hostname, ip: ipFor(hostname), ms: 70, donor: body.donors[0] }))
  });
}

const fetchMock = vi.fn();
const blobs: Blob[] = [];
const revoke = vi.fn();

function requestBody(call: unknown[]): any {
  return JSON.parse(String((call[1] as RequestInit).body));
}

function callsTo(url: string): any[] {
  return fetchMock.mock.calls.filter((call) => call[0] === url).map(requestBody);
}

function renderBuilder() {
  render(
    <LocaleProvider>
      <HostsBuilder />
    </LocaleProvider>
  );
}

/** Supplies the base file through the File API, which must not touch the server at all. */
async function uploadBase(text = BASE, name = "hosts") {
  fireEvent.click(screen.getByRole("radio", { name: "Файл с компьютера" }));
  fireEvent.change(screen.getByLabelText("Выберите файл hosts"), {
    target: { files: [new File([text], name, { type: "text/plain" })] }
  });
  await screen.findByText(`В файле ${name}`);
}

function start() {
  fireEvent.click(screen.getByRole("button", { name: "Собрать файл" }));
}

describe("HostsBuilder", () => {
  beforeEach(() => {
    blobs.length = 0;
    revoke.mockReset();
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return `blob:hosts-${blobs.length}`;
      }),
      revokeObjectURL: revoke
    });

    donorChecks.checkDonor.mockReset();
    donorChecks.checkDonor.mockResolvedValue({ dnsMs: 100, chatgptMs: 300, country: "NL", direct: false });
    donorChecks.visitorCountry.mockReset();
    donorChecks.visitorCountry.mockResolvedValue("UZ");

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      if (url === "/api/hosts/source") return jsonResponse({ text: BASE, url: "https://geohide.ru/hosts" });
      if (url === "/api/hosts/resolve") return resolveResponse(body);
      throw new Error(`unexpected request to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows what is in the file once a published list is loaded", async () => {
    renderBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Загрузить" }));

    expect(callsTo("/api/hosts/source")).toEqual([{ source: "geohide" }]);
    expect(await screen.findByText("В файле https://geohide.ru/hosts")).toBeInTheDocument();
    expect(screen.getByText("Записей: 5 в 6 строках")).toBeInTheDocument();
    // Two, not three: the single-label entry is legal and is kept, but no public resolver can be asked about it.
    expect(screen.getByText("Доменов для перепроверки: 2")).toBeInTheDocument();
    expect(screen.getByText("Блокирующих записей без изменений: 1")).toBeInTheDocument();
  });

  it("asks the server for the published list the user picked", async () => {
    renderBuilder();

    fireEvent.change(screen.getByLabelText("Какой готовый список"), { target: { value: "malw" } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить" }));

    expect(callsTo("/api/hosts/source")).toEqual([{ source: "malw" }]);
    await screen.findByText("В файле https://geohide.ru/hosts");
  });

  it("passes an address of the user's own to the server untouched", async () => {
    renderBuilder();

    fireEvent.click(screen.getByRole("radio", { name: "Свой адрес" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Адрес файла hosts" }), {
      target: { value: " https://lists.example/hosts " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить" }));

    expect(callsTo("/api/hosts/source")).toEqual([{ url: "https://lists.example/hosts" }]);
    await screen.findByText("В файле https://geohide.ru/hosts");
  });

  it("refuses an address that is not HTTPS without calling the server", async () => {
    renderBuilder();

    fireEvent.click(screen.getByRole("radio", { name: "Свой адрес" }));
    const input = screen.getByRole("textbox", { name: "Адрес файла hosts" });
    fireEvent.change(input, { target: { value: "http://lists.example/hosts" } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить" }));

    expect(await screen.findByText("Введите HTTPS-адрес вида https://example.com/hosts")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Введите HTTPS-адрес вида https://example.com/hosts");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never calls the server for a file from the user's computer", async () => {
    renderBuilder();

    await uploadBase();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Доменов для перепроверки: 2")).toBeInTheDocument();
  });

  it("sends exactly the donor chosen in manual mode", async () => {
    renderBuilder();
    await uploadBase();

    fireEvent.click(screen.getByRole("radio", { name: "Использовать выбранный" }));
    fireEvent.click(screen.getByRole("combobox", { name: "DNS-донор" }));
    fireEvent.click(await screen.findByRole("option", { name: /^Comss\./ }));
    start();

    await screen.findByRole("link", { name: "Скачать файл hosts" });
    expect(callsTo("/api/hosts/resolve").map((body) => body.donors)).toEqual([["https://dns.comss.one/dns-query"]]);
  });

  it("ranks the donors by measured latency before resolving and sends the best four, fastest first", async () => {
    const latencies: (number | null)[] = [null, 300, 50, null, 120, 90, 200, 400, 410, 420, 430];
    const dnsMsOf = new Map(DNS_DONORS.map((donor, index) => [donor.value, latencies[index]]));
    donorChecks.checkDonor.mockImplementation(async (donor: string) => ({
      dnsMs: dnsMsOf.get(donor) ?? null,
      chatgptMs: 300,
      country: "NL",
      direct: false
    }));
    renderBuilder();
    await uploadBase();

    start();

    expect(await screen.findByText("Проверяем, какие DNS-прокси отвечают…")).toBeInTheDocument();
    await screen.findByRole("link", { name: "Скачать файл hosts" });
    expect(callsTo("/api/hosts/resolve")[0].donors).toEqual([
      DNS_DONORS[2].value,
      DNS_DONORS[5].value,
      DNS_DONORS[4].value,
      DNS_DONORS[6].value
    ]);
  });

  it("stops with a message when no donor answers at all", async () => {
    donorChecks.checkDonor.mockResolvedValue({ dnsMs: null, chatgptMs: null, country: null, direct: false });
    renderBuilder();
    await uploadBase();

    start();

    expect(
      await screen.findByText("Ни один DNS-прокси не ответил, перепроверять домены не через что.")
    ).toBeInTheDocument();
    expect(callsTo("/api/hosts/resolve")).toEqual([]);
  });

  it("splits the domains into batches of fifty and keeps at most two of them in flight", async () => {
    const pending: { hostnames: string[]; respond: () => void }[] = [];
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Promise<Response>((resolve) => {
        pending.push({ hostnames: body.hostnames, respond: () => resolve(resolveResponse(body)) });
      });
    });
    renderBuilder();
    await uploadBase(manyHosts(120), "big");

    start();

    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending.map((batch) => batch.hostnames.length)).toEqual([50, 50]);
    // A third batch only goes out once one of the two in flight has answered.
    pending[0].respond();
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2].hostnames).toHaveLength(20);
    pending[1].respond();
    pending[2].respond();

    await screen.findByRole("link", { name: "Скачать файл hosts" });
    expect(pending).toHaveLength(3);
  });

  it("advances the progress counts as batches come back", async () => {
    const pending: { respond: () => void }[] = [];
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Promise<Response>((resolve) => {
        pending.push({ respond: () => resolve(resolveResponse(body)) });
      });
    });
    renderBuilder();
    await uploadBase(manyHosts(120), "big");

    start();

    const bar = await screen.findByRole("progressbar", { name: "Перепроверка доменов" });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "120");

    await waitFor(() => expect(pending).toHaveLength(2));
    pending[0].respond();
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "50"));
    expect(bar).toHaveAttribute("aria-valuetext", "50 из 120 доменов: 50 с рабочим адресом, 0 оставили прежний");
    expect(
      screen.getByText("50 из 120 доменов: 50 с рабочим адресом, 0 оставили прежний")
    ).toBeInTheDocument();

    pending[1].respond();
    await waitFor(() => expect(pending).toHaveLength(3));
    pending[2].respond();
    await screen.findByRole("link", { name: "Скачать файл hosts" });
    expect(bar).toHaveAttribute("aria-valuenow", "120");
  });

  it("retries a batch the server refused with 429 instead of failing the run", async () => {
    let refusals = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (refusals === 0) {
        refusals += 1;
        return jsonResponse({ error: "Too many batches at once." }, 429);
      }
      return resolveResponse(body);
    });
    renderBuilder();
    await uploadBase();

    start();

    await screen.findByRole("link", { name: "Скачать файл hosts" }, { timeout: 3000 });
    const sent = callsTo("/api/hosts/resolve");
    expect(sent).toHaveLength(2);
    expect(sent[1].hostnames).toEqual(sent[0].hostnames);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Готово: 2 из 3 доменов получили рабочий адрес, 1 оставили прежний."
    );
  });

  it("cancels a run while the donor checks are still out", async () => {
    // A check that never answers: the run waits for the whole set, so cancelling must not wait with it.
    donorChecks.checkDonor.mockReturnValue(new Promise(() => {}));
    renderBuilder();
    await uploadBase();

    start();

    expect(await screen.findByText("Проверяем, какие DNS-прокси отвечают…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(await screen.findByText("Отменено. Файл не собран.")).toBeInTheDocument();
    expect(callsTo("/api/hosts/resolve")).toEqual([]);
  });

  it("aborts the requests in flight when the run is cancelled", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(
      (url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signals.push(init.signal as AbortSignal);
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    renderBuilder();
    await uploadBase();

    start();
    await waitFor(() => expect(signals).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(signals[0].aborted).toBe(true);
    expect(await screen.findByText("Отменено. Файл не собран.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Скачать файл hosts" })).not.toBeInTheDocument();
  });

  it("offers the rewritten file for download and reports which donor answered", async () => {
    renderBuilder();
    await uploadBase();

    start();

    const link = await screen.findByRole("link", { name: "Скачать файл hosts" });
    expect(link).toHaveAttribute("download", "hosts");
    expect(link).toHaveAttribute("href", "blob:hosts-1");
    expect(await blobs[0].text()).toBe(
      applyOverrides(parseHosts(BASE), { "a.example": ipFor("a.example"), "b.example": ipFor("b.example") })
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Готово: 2 из 3 доменов получили рабочий адрес, 1 оставили прежний."
    );
    expect(screen.getByRole("row", { name: /GeoHide RU 2/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Оставили прежний адрес 1/ })).toBeInTheDocument();

    // A second run replaces the offer, so the previous object URL is released.
    start();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:hosts-1"));
  });

  it("keeps the blocking entries and the names it could not resolve in the produced file", async () => {
    renderBuilder();
    await uploadBase();

    start();
    await screen.findByRole("link", { name: "Скачать файл hosts" });

    const produced = (await blobs[0].text()).split(CRLF);
    expect(produced).toContain("0.0.0.0 ads.example");
    expect(produced).toContain("4.4.4.4 single");
    expect(produced).toContain("# base list");
    expect(produced).toContain(`${ipFor("a.example")} a.example`);
    // Nothing a public resolver cannot answer for is sent, and it still counts towards the totals as kept.
    expect(callsTo("/api/hosts/resolve")[0].hostnames).toEqual(["a.example", "b.example"]);
    expect(screen.getByRole("progressbar", { name: "Перепроверка доменов" })).toHaveAttribute("aria-valuemax", "3");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Готово: 2 из 3 доменов получили рабочий адрес, 1 оставили прежний."
    );
  });
});
