import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DNS_DONORS } from "@/domain/dns-donors";
import { applyOverrides, parseHosts } from "@/domain/hosts";
import { LocaleProvider } from "@/lib/i18n/context";
import { CustomDonorsProvider } from "@/components/wizard/custom-donors";
import { HiddenDonorsProvider } from "@/components/wizard/hidden-donors";
import { DnsMonitor } from "./dns-monitor";
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

/**
 * One of each kind of entry, so the three groups in the summary are all non-empty: a domain to refresh, a blocking
 * pin, and the two a run can only copy through - an IPv6 address and a line whose name is not a name.
 */
const BASE_WITH_OTHER =
  [
    "# base list",
    "1.1.1.1 a.example",
    "0.0.0.0 ads.example",
    "2a00::1 c.example",
    "5.5.5.5 not a_hostname!"
  ].join(CRLF) + CRLF;

/** Two sites with their names interleaved, the way a published list carries them. */
function twoSites(each: number): string {
  const lines: string[] = [];
  for (let index = 0; index < each; index++) {
    lines.push(`1.1.1.1 n${index}.alpha.example`, `1.1.1.1 n${index}.beta.example`);
  }
  return lines.join(CRLF) + CRLF;
}

/** One site with more names than a batch holds, followed by a handful of sites with one name each. */
function bigSite(size: number, others: number): string {
  const lines = Array.from({ length: size }, (_, index) => `1.1.1.1 n${index}.big.example`);
  for (let index = 0; index < others; index++) lines.push(`1.1.1.1 www.other${index}.example`);
  return lines.join(CRLF) + CRLF;
}

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

/** Which donor supplies the address for a hostname in a held batch; `null` leaves it without one. */
type Answer = string | null | ((hostname: string) => string | null);

/** One batch, as the component asked for it, with its answer held back until the test lets it through. */
type Batch = { donors: string[]; hostnames: string[]; answer: (by: Answer) => void };

/**
 * Eleven latencies for the eleven presets, so the pre-run ranking picks a known four, fastest first: the order the
 * run starts from and the one the coverage ranking has to move away from.
 */
const DNS_MS: readonly (number | null)[] = [null, 300, 50, null, 120, 90, 200, 400, 410, 420, 430];
/** Every preset that answers under `DNS_MS`, fastest first: what a run uses when the user leaves the list alone. */
const FASTEST = DNS_DONORS.map((donor, index) => ({ donor: donor.value, ms: DNS_MS[index] }))
  .filter(({ ms }) => ms !== null)
  .sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0))
  .map(({ donor }) => donor);

/** Answers every hostname in the batch with the given donor, whatever place the component gave it in the walk. */
function answeredBy(donor: string, body: { hostnames: string[] }): Response {
  return jsonResponse({ results: body.hostnames.map((hostname) => ({ hostname, ip: ipFor(hostname), ms: 70, donor })) });
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

/** Puts `DNS_MS` behind the donor checks, so the run starts in the `FASTEST` order. */
function withLatencies() {
  const dnsMsOf = new Map(DNS_DONORS.map((donor, index) => [donor.value, DNS_MS[index]]));
  donorChecks.checkDonor.mockImplementation(async (donor: string) => {
    // A donor whose DNS never answered has no ChatGPT time either, as the check route reports it.
    const dnsMs = dnsMsOf.get(donor) ?? null;
    return dnsMs === null
      ? { dnsMs: null, chatgptMs: null, country: null, direct: false, reason: null }
      : { dnsMs, chatgptMs: 300, country: "NL", direct: false, reason: null };
  });
}

/**
 * Holds every batch until the test answers it, so a test can see exactly which donors the component sent and what
 * it does with the answer. The answering donor is chosen per batch, and answering with `null` leaves the whole
 * batch without an address, which is what sends its hostnames into the sweep. Aborting rejects, as fetch does.
 */
function heldBatches(): Batch[] {
  const pending: Batch[] = [];
  fetchMock.mockImplementation((url: string, init: RequestInit) => {
    // Only the batches are held: the list of proxies this container has been given answers at once, as it does.
    if (url === "/api/donors/custom") return Promise.resolve(jsonResponse({ donors: [] }));
    const body = JSON.parse(String(init.body)) as { donors: string[]; hostnames: string[] };
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      pending.push({
        donors: body.donors,
        hostnames: body.hostnames,
        answer: (by) => {
          const donorOf = typeof by === "function" ? by : () => by;
          resolve(
            jsonResponse({
              results: body.hostnames.map((hostname) => {
                const donor = donorOf(hostname);
                return donor === null
                  ? { hostname, ip: null, ms: null, donor: null }
                  : { hostname, ip: ipFor(hostname), ms: 70, donor };
              })
            })
          );
        }
      });
    });
  });
  return pending;
}

function renderBuilder() {
  render(
    <LocaleProvider>
      <CustomDonorsProvider>
        <HiddenDonorsProvider>
          <HostsBuilder />
        </HiddenDonorsProvider>
      </CustomDonorsProvider>
    </LocaleProvider>
  );
}

/** Supplies the base file through the File API, which must not touch the server at all. */
async function uploadBase(text = BASE, name = "hosts") {
  fireEvent.click(screen.getByRole("radio", { name: "Файл с компьютера" }));
  fireEvent.change(screen.getByLabelText("Выберите файл hosts"), {
    target: { files: [new File([text], name, { type: "text/plain" })] }
  });
  await screen.findByText(`В файле (${name})`);
}

function start() {
  fireEvent.click(screen.getByRole("button", { name: "Собрать файл" }));
}

describe("HostsBuilder", () => {
  beforeEach(() => {
    // The hidden servers are remembered in this browser, and jsdom's is shared by every test in the file.
    window.localStorage.clear();
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
      if (url === "/api/donors/custom") return jsonResponse({ donors: [] });
      // Only the monitor asks for this one, and only when a test renders it alongside the panel.
      if (url === "/api/donors/custom") return jsonResponse({ donors: [] });
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
    // The address is behind the word rather than printed into the summary.
    expect(await screen.findByRole("link", { name: "источник" })).toHaveAttribute(
      "href",
      "https://geohide.ru/hosts"
    );
    expect(screen.getByText("Записей: 5 в 6 строках")).toBeInTheDocument();
    // The three groups account for all five entries: four to refresh, one blocking pin, nothing else.
    expect(screen.getByText("Перенаправление: 4")).toBeInTheDocument();
    expect(screen.getByText("Блокировка: 1")).toBeInTheDocument();
    expect(screen.getByText("Прочее: 0")).toBeInTheDocument();
    // Each group says what it is, since a count alone does not tell the user what will happen to those entries.
    expect(screen.getByRole("note", { name: "Домены, перенаправляемые на прокси" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Оставить заблокированные домены в итоговом файле" })).toBeChecked();
    // Nothing to include or leave out of an empty group, so it is offered no choice.
    expect(
      screen.queryByRole("checkbox", { name: "Оставить прочие записи в итоговом файле" })
    ).not.toBeInTheDocument();
  });

  it("asks the server for the published list the user picked", async () => {
    renderBuilder();

    fireEvent.change(screen.getByLabelText("Какой готовый список"), { target: { value: "malw" } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить" }));

    expect(callsTo("/api/hosts/source")).toEqual([{ source: "malw" }]);
    await screen.findByRole("link", { name: "источник" });
  });

  it("passes an address of the user's own to the server untouched", async () => {
    renderBuilder();

    fireEvent.click(screen.getByRole("radio", { name: "Свой адрес" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Адрес файла hosts" }), {
      target: { value: " https://lists.example/hosts " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить" }));

    expect(callsTo("/api/hosts/source")).toEqual([{ url: "https://lists.example/hosts" }]);
    await screen.findByRole("link", { name: "источник" });
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
    expect(callsTo("/api/hosts/source")).toEqual([]);
  });

  it("never calls the server for a file from the user's computer", async () => {
    renderBuilder();

    await uploadBase();

    expect(callsTo("/api/hosts/source")).toEqual([]);
    expect(screen.getByText("Перенаправление: 4")).toBeInTheDocument();
    // A file of the user's own has no address to link to, so its name stands in the heading instead.
    expect(screen.queryByRole("link", { name: "источник" })).not.toBeInTheDocument();
  });

  it("sends exactly the proxies left ticked", async () => {
    renderBuilder();
    await uploadBase();

    // Every proxy that answers starts ticked, so choosing one means taking the others out.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /^Comss/ })).toBeChecked());
    for (const donor of DNS_DONORS) {
      if (donor.label === "Comss") continue;
      const box = screen.getByRole("checkbox", { name: new RegExp(`^${donor.label}`) });
      if ((box as HTMLInputElement).checked) fireEvent.click(box);
    }
    start();

    await screen.findByRole("link", { name: "Скачать файл hosts" });
    expect(callsTo("/api/hosts/resolve").map((body) => body.donors)).toEqual([["https://dns.comss.one/dns-query"]]);
  });

  it("drops a proxy hidden in the monitor from this list, and lists it again unticked on request", async () => {
    // Both panels at once, under the one store they share: hiding a row there is what has to reach the list here.
    render(
      <LocaleProvider>
        <CustomDonorsProvider>
          <HiddenDonorsProvider>
            <DnsMonitor />
            <HostsBuilder />
          </HiddenDonorsProvider>
        </CustomDonorsProvider>
      </LocaleProvider>
    );
    await uploadBase();
    const box = () => screen.queryByRole("checkbox", { name: /^Comss/ });
    await waitFor(() => expect(box()).toBeChecked());

    fireEvent.click(screen.getByRole("button", { name: "Скрыть Comss" }));

    expect(box()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "показать скрытые (1)" }));

    // Listed again so it can be chosen by hand, but not ticked: hiding it was not a vote for using it.
    expect(box()).not.toBeChecked();
  });

  it("leaves a proxy unticked when the monitor could not reach ChatGPT through it", async () => {
    const dead = DNS_DONORS[1];
    donorChecks.checkDonor.mockImplementation(async (donor: string) =>
      donor === dead.value
        // Answers DNS, but its address does not serve chatgpt.com: asking it would cost every domain a lookup.
        ? { dnsMs: 90, chatgptMs: null, country: null, direct: false, reason: "unreachable" }
        : { dnsMs: 100, chatgptMs: 300, country: "NL", direct: false, reason: null }
    );
    renderBuilder();
    await uploadBase();

    const box = await screen.findByRole("checkbox", { name: new RegExp(`^${dead.label}`) });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /^Comss/ })).toBeChecked());
    expect(box).not.toBeChecked();
    // The row says why rather than leaving an unticked box next to a healthy-looking DNS time.
    expect(box.closest("label")).toHaveTextContent(`${dead.label}без ChatGPT`);

    // It is a default, not a rule: the user can still put it in.
    fireEvent.click(box);
    expect(box).toBeChecked();
  });

  it("ranks the donors by measured latency before resolving and sends the best four, fastest first", async () => {
    withLatencies();
    renderBuilder();
    await uploadBase();

    start();

    expect(await screen.findByText("Проверяем, какие DNS-прокси отвечают…")).toBeInTheDocument();
    await screen.findByRole("link", { name: "Скачать файл hosts" });
    // Nothing is known about coverage before the first answer, so latency is all the first batch can go on.
    expect(callsTo("/api/hosts/resolve")[0].donors).toEqual(FASTEST);
  });

  it("narrows the batches after discovery to the two donors with the best coverage", async () => {
    withLatencies();
    // The measured shape of the defect: the third-fastest donor is the one that covers the file.
    const pending = heldBatches();
    renderBuilder();
    await uploadBase(manyHosts(120), "big");

    start();

    // The two batches in flight are the discovery pass: dispatched before any answer, nothing about coverage is
    // known yet, so both carry the whole ranked list in the latency order.
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].donors).toEqual(FASTEST);
    expect(pending[1].donors).toEqual(FASTEST);

    pending[0].answer(FASTEST[2]);

    await waitFor(() => expect(pending).toHaveLength(3));
    // Discovery is over, so only the best two by coverage are asked: the donor that answered all fifty, and the
    // one that was never reached, since an unobserved donor is better odds than the two that missed every name.
    // The twenty-second saving the measurement found is exactly these two attempts that are no longer made.
    expect(pending[2].donors).toEqual([FASTEST[2], FASTEST[3]]);

    pending[1].answer(FASTEST[2]);
    pending[2].answer(FASTEST[2]);
    await screen.findByRole("link", { name: "Скачать файл hosts" });
  });

  it("keeps a donor nothing is known about yet ahead of one that was asked and missed", async () => {
    withLatencies();
    const pending = heldBatches();
    renderBuilder();
    await uploadBase(manyHosts(120), "big");

    start();

    await waitFor(() => expect(pending).toHaveLength(2));
    pending[0].answer(FASTEST[1]);

    await waitFor(() => expect(pending).toHaveLength(3));
    // Only the second-fastest has a record: the fastest missed all fifty, the last two were never reached. An
    // unobserved donor is worth trying before a demonstrated miss, so it is the second of the narrowed pair.
    expect(pending[2].donors).toEqual([FASTEST[1], FASTEST[2]]);

    pending[1].answer(FASTEST[1]);
    pending[2].answer(FASTEST[1]);
    await screen.findByRole("link", { name: "Скачать файл hosts" });
  });

  it("re-picks the narrowed pair from the tally instead of trusting the first leader to the end", async () => {
    withLatencies();
    const pending = heldBatches();
    renderBuilder();
    await uploadBase(manyHosts(200), "big");

    start();

    await waitFor(() => expect(pending).toHaveLength(2));
    pending[0].answer(FASTEST[2]);
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2].donors).toEqual([FASTEST[2], FASTEST[3]]);

    // The second discovery batch says the fourth donor covers far more than the third, which had been leading
    // only because it answered first. The next batch must go to the new pair, not to the one already chosen.
    pending[1].answer(FASTEST[3]);
    await waitFor(() => expect(pending).toHaveLength(4));
    expect(pending[3].donors).toEqual([FASTEST[3], FASTEST[2]]);

    pending[2].answer(FASTEST[3]);
    pending[3].answer(FASTEST[3]);
    await screen.findByRole("link", { name: "Скачать файл hosts" });
  });

  it("sweeps the domains the narrowed pass left without an address, asking only the donors it did not use", async () => {
    withLatencies();
    const pending = heldBatches();
    renderBuilder();
    await uploadBase(manyHosts(120), "big");

    start();

    await waitFor(() => expect(pending).toHaveLength(2));
    pending[0].answer(FASTEST[2]);
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2].donors).toEqual([FASTEST[2], FASTEST[3]]);
    pending[1].answer(FASTEST[2]);
    // The narrowed pair resolves none of the last twenty, which is the case narrowing has to be safe for.
    pending[2].answer(null);

    await waitFor(() => expect(pending).toHaveLength(4));
    // Exactly the donors the narrowed pass did not ask, so these twenty end the run having been put to every one
    // of them once — the same total they paid when every batch carried the whole list.
    expect([...pending[3].donors].sort()).toEqual(FASTEST.filter((donor) => !pending[2].donors.includes(donor)).sort());
    expect(pending[3].hostnames).toEqual(pending[2].hostnames);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Добираем оставшимися прокси домены, которые ещё без адреса…"
    );
    // Still counted as kept while the sweep is out: the counts describe the file as it stands, and the sweep can
    // only move a domain from kept to resolved, never the other way.
    expect(screen.getByRole("progressbar", { name: "Перепроверка доменов" })).toHaveAttribute(
      "aria-valuetext",
      "120 из 120 доменов: 100 с рабочим адресом, 20 оставили прежний"
    );

    pending[3].answer(FASTEST[0]);

    await screen.findByRole("link", { name: "Скачать файл hosts" });
    // Resolved by the sweep, so resolved rose and kept fell to nothing; `resolved + kept` is still `done`.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Готово: 120 из 120 доменов получили рабочий адрес, 0 оставили прежний."
    );
    expect(screen.getByRole("progressbar", { name: "Перепроверка доменов" })).toHaveAttribute(
      "aria-valuetext",
      "120 из 120 доменов: 120 с рабочим адресом, 0 оставили прежний"
    );
    // The donor that answered during the sweep is credited, and the table still sums to the total.
    expect(screen.getByRole("row", { name: /MagicDNS 100/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /GeoHide US 20/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Оставили прежний адрес 0/ })).toBeInTheDocument();
    // And the address it supplied is in the produced file, not just in the counts.
    const produced = (await blobs[0].text()).split(CRLF);
    expect(produced).toContain(`${ipFor("h119.example")} h119.example`);
  });

  it("does not sweep when the narrowed pass left nothing without an address", async () => {
    withLatencies();
    const pending = heldBatches();
    renderBuilder();
    await uploadBase(manyHosts(120), "big");

    start();

    await waitFor(() => expect(pending).toHaveLength(2));
    pending[0].answer(FASTEST[2]);
    await waitFor(() => expect(pending).toHaveLength(3));
    pending[1].answer(FASTEST[2]);
    pending[2].answer(FASTEST[2]);

    await screen.findByRole("link", { name: "Скачать файл hosts" });
    expect(pending).toHaveLength(3);
  });

  it("does not sweep when the narrowed pass was already asking every donor it has", async () => {
    // Only two donors answer the checks at all, so narrowing to two takes nothing away and leaves nothing over.
    const answering = [DNS_DONORS[4].value, DNS_DONORS[6].value];
    donorChecks.checkDonor.mockImplementation(async (donor: string) => ({
      dnsMs: answering.includes(donor) ? 50 : null,
      chatgptMs: 300,
      country: "NL",
      direct: false
    }));
    const pending = heldBatches();
    renderBuilder();
    await uploadBase(manyHosts(120), "big");

    start();

    await waitFor(() => expect(pending).toHaveLength(2));
    pending[0].answer(answering[0]);
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2].donors).toEqual(answering);
    pending[1].answer(answering[0]);
    pending[2].answer(null);

    await screen.findByRole("link", { name: "Скачать файл hosts" });
    // The last twenty were walked through both donors already; there is no third to ask them.
    expect(pending).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Готово: 100 из 120 доменов получили рабочий адрес, 20 оставили прежний."
    );
  });

  it("cancels a run while the sweep is out and still offers no file", async () => {
    withLatencies();
    const pending = heldBatches();
    renderBuilder();
    await uploadBase(manyHosts(120), "big");

    start();

    await waitFor(() => expect(pending).toHaveLength(2));
    pending[0].answer(FASTEST[2]);
    await waitFor(() => expect(pending).toHaveLength(3));
    pending[1].answer(FASTEST[2]);
    pending[2].answer(null);
    await waitFor(() => expect(pending).toHaveLength(4));

    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(await screen.findByText("Отменено. Файл не собран.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Скачать файл hosts" })).not.toBeInTheDocument();
  });

  it("starts a new run from the latency order instead of inheriting the last run's tally", async () => {
    withLatencies();
    fetchMock.mockImplementation(async (url: string, init: RequestInit) =>
      answeredBy(FASTEST[2], JSON.parse(String(init.body)))
    );
    renderBuilder();
    await uploadBase(manyHosts(120), "big");

    start();
    await screen.findByRole("link", { name: "Скачать файл hosts" });
    const firstRun = callsTo("/api/hosts/resolve");
    expect(firstRun).toHaveLength(3);
    expect(firstRun[2].donors[0]).toBe(FASTEST[2]);

    start();

    await waitFor(() => expect(callsTo("/api/hosts/resolve")).toHaveLength(6));
    // What the previous run learned is gone with it: donors may have changed places since, so the second run
    // starts over from its own fresh checks.
    expect(callsTo("/api/hosts/resolve")[3].donors).toEqual(FASTEST);
    expect(callsTo("/api/hosts/resolve")[5].donors[0]).toBe(FASTEST[2]);
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
      if (url === "/api/donors/custom") return Promise.resolve(jsonResponse({ donors: [] }));
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
      if (url === "/api/donors/custom") return Promise.resolve(jsonResponse({ donors: [] }));
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

  it("keeps a site's hostnames in one batch instead of cutting them at fifty", async () => {
    renderBuilder();
    await uploadBase(twoSites(30), "sites");

    start();
    await screen.findByRole("link", { name: "Скачать файл hosts" });

    // Sixty names could have gone out as fifty and ten; they go out as two whole sites instead, because only a
    // batch that holds the whole site can settle it on one address.
    const batches = callsTo("/api/hosts/resolve").map((body) => body.hostnames as string[]);
    expect(batches.map((names) => names.length)).toEqual([30, 30]);
    expect(batches[0].every((name) => name.endsWith(".alpha.example"))).toBe(true);
    expect(batches[1].every((name) => name.endsWith(".beta.example"))).toBe(true);
  });

  it("pins the address a site settled on for the piece of it left until the end", async () => {
    renderBuilder();
    await uploadBase(bigSite(60, 20), "big");

    start();
    await screen.findByRole("link", { name: "Скачать файл hosts" });

    const calls = callsTo("/api/hosts/resolve");
    // The site's first fifty go out with everyone else, and its last ten wait for the end of the run.
    expect(calls.map((body) => body.hostnames.length)).toEqual([50, 20, 10]);
    expect(calls[0].pinned).toEqual({});
    expect(calls[1].pinned).toEqual({});
    expect(calls[2].pinned).toEqual({ "big.example": ipFor("n0.big.example") });
  });

  it("credits a hostname that took its site's address to the donor that supplied it", async () => {
    const site = ["1.1.1.1 example.com", "1.1.1.1 www.example.com", "1.1.1.1 api.example.com"].join(CRLF) + CRLF;
    // The server names a donor only for the name it actually asked about; the other two took that same address.
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { donors: string[]; hostnames: string[] };
      return jsonResponse({
        results: body.hostnames.map((hostname) => ({
          hostname,
          ip: "203.0.113.9",
          ms: 70,
          donor: hostname === "example.com" ? body.donors[0] : null
        }))
      });
    });
    renderBuilder();
    await uploadBase(site, "site");

    start();
    await screen.findByRole("link", { name: "Скачать файл hosts" });

    // All three are the donor's work, even though it was asked about one of them.
    expect(screen.getByRole("row", { name: /GeoHide RU 3/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Готово: 3 из 3 доменов получили рабочий адрес");
    const produced = (await blobs[0].text()).split(CRLF);
    expect(produced.filter((line) => line.startsWith("203.0.113.9"))).toHaveLength(3);
  });

  it("leaves the blocking entries out of the file once the user unticks them", async () => {
    renderBuilder();
    await uploadBase(BASE_WITH_OTHER, "mixed");

    start();
    await screen.findByRole("link", { name: "Скачать файл hosts" });
    expect((await blobs[0].text()).split(CRLF)).toContain("0.0.0.0 ads.example");

    fireEvent.click(screen.getByRole("checkbox", { name: "Оставить заблокированные домены в итоговом файле" }));

    await waitFor(() => expect(blobs).toHaveLength(2));
    const produced = (await blobs[1].text()).split(CRLF);
    expect(produced).not.toContain("0.0.0.0 ads.example");
    // Only that group goes: the refreshed entry, the ones it cannot refresh and the comment all stay.
    expect(produced).toContain(`${ipFor("a.example")} a.example`);
    expect(produced).toContain("2a00::1 c.example");
    expect(produced).toContain("# base list");
    expect(screen.getByRole("link", { name: "Скачать файл hosts" })).toHaveAttribute("href", "blob:hosts-2");
    // Rebuilt from the answers already in hand, so the choice costs no DNS.
    expect(callsTo("/api/hosts/resolve")).toHaveLength(1);
  });

  it("leaves the entries it cannot refresh out of the file once the user unticks them", async () => {
    renderBuilder();
    await uploadBase(BASE_WITH_OTHER, "mixed");

    start();
    await screen.findByRole("link", { name: "Скачать файл hosts" });
    expect(screen.getByText("Прочее: 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Оставить прочие записи в итоговом файле" }));

    await waitFor(() => expect(blobs).toHaveLength(2));
    const produced = (await blobs[1].text()).split(CRLF);
    expect(produced).not.toContain("2a00::1 c.example");
    expect(produced).not.toContain("5.5.5.5 not a_hostname!");
    expect(produced).toContain("0.0.0.0 ads.example");
    expect(produced).toContain(`${ipFor("a.example")} a.example`);
  });
});
