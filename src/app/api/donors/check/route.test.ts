import { beforeEach, describe, expect, it, vi } from "vitest";
import { DNS_DONORS } from "@/domain/dns-donors";
import { POST } from "./route";

const dohMocks = vi.hoisted(() => ({ resolveA: vi.fn(), traceCountry: vi.fn() }));

// The address filter stays real so the route test covers which IPs are contacted.
vi.mock("@/lib/dns/doh", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/dns/doh")>()), ...dohMocks }));

function checkRequest(body: unknown) {
  return new Request("http://localhost/api/donors/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/donors/check", () => {
  beforeEach(() => {
    dohMocks.resolveA.mockReset();
    // Every check also looks up the server exit IP unless an earlier one cached it.
    dohMocks.traceCountry.mockReset().mockResolvedValue(null);
  });

  it.each(["http://dns.example/dns-query", "https://user:pass@dns.example/dns-query", "not a url", `https://dns.example/${"a".repeat(2048)}`])(
    "rejects %s",
    async (donor) => {
      const response = await POST(checkRequest({ donor }));

      expect(response.status).toBe(400);
      expect(dohMocks.resolveA).not.toHaveBeenCalled();
    }
  );

  it("checks a custom HTTPS DoH URL and never contacts internal addresses it returns", async () => {
    dohMocks.resolveA.mockResolvedValue(["10.0.0.5", "169.254.169.254", "203.0.113.9"]);
    dohMocks.traceCountry.mockResolvedValue({ country: "NL", ms: 70 });

    const response = await POST(checkRequest({ donor: "https://dns.example/dns-query" }));

    expect(await response.json()).toMatchObject({ dnsMs: expect.any(Number), chatgptMs: 70, country: "NL", direct: false });
    const contacted = dohMocks.traceCountry.mock.calls.filter(([, host]) => host === "chatgpt.com").map(([ip]) => ip);
    expect(contacted).toEqual(["203.0.113.9"]);
  });

  it("passes with the exit country and timing of the first usable address", async () => {
    dohMocks.resolveA.mockResolvedValue(["1.1.1.1", "2.2.2.2"]);
    dohMocks.traceCountry.mockImplementation(async (ip: string) => (ip === "2.2.2.2" ? { country: "NL", ms: 42 } : null));

    const response = await POST(checkRequest({ donor: "https://dns.magicdns.ru/dns-query" }));

    expect(await response.json()).toMatchObject({ dnsMs: expect.any(Number), chatgptMs: 42, country: "NL", direct: false });
    expect(dohMocks.resolveA).toHaveBeenCalledWith("https://dns.magicdns.ru/dns-query", "chatgpt.com", 5000);
    expect(dohMocks.traceCountry).toHaveBeenCalledWith("2.2.2.2", "chatgpt.com", 5000);
  });

  it.each(["RU", "BY"])("fails when chatgpt.com sees the connection exit in %s", async (country) => {
    dohMocks.resolveA.mockResolvedValue(["1.1.1.1"]);
    dohMocks.traceCountry.mockResolvedValue({ country, ms: 30 });

    const response = await POST(checkRequest({ donor: "https://dns.dns-ai.ru/dns-query" }));

    expect(await response.json()).toMatchObject({ dnsMs: expect.any(Number), chatgptMs: null, country, direct: false });
  });

  it("prefers an address that exits in an allowed country", async () => {
    dohMocks.resolveA.mockResolvedValue(["1.1.1.1", "2.2.2.2"]);
    dohMocks.traceCountry.mockImplementation(async (ip: string) => ({ country: ip === "1.1.1.1" ? "RU" : "DE", ms: 50 }));

    const response = await POST(checkRequest({ donor: "https://geohide.ru/dns-query" }));

    expect(await response.json()).toMatchObject({ dnsMs: expect.any(Number), chatgptMs: 50, country: "DE", direct: false });
  });

  it("fails the chatgpt.com check when no address answers", async () => {
    dohMocks.resolveA.mockResolvedValue(["1.1.1.1"]);
    dohMocks.traceCountry.mockResolvedValue(null);

    const response = await POST(checkRequest({ donor: "https://dns.zapret.moe/dns-query" }));

    expect(await response.json()).toMatchObject({ dnsMs: expect.any(Number), chatgptMs: null, country: null, direct: false });
  });

  it("fails both checks when the donor does not resolve", async () => {
    dohMocks.resolveA.mockRejectedValue(new Error("timeout"));

    const response = await POST(checkRequest({ donor: "https://dns.dagami.ru/dns-query" }));

    expect(await response.json()).toEqual({ dnsMs: null, chatgptMs: null, country: null, direct: false });
    expect(dohMocks.traceCountry).not.toHaveBeenCalledWith(expect.anything(), "chatgpt.com", expect.anything());
  });

  it("shares one check between concurrent requests but runs a fresh one afterwards", async () => {
    dohMocks.resolveA.mockResolvedValue([]);
    const donor = { donor: "https://dns.wlrus.cfd/dns-query" };

    await Promise.all([POST(checkRequest(donor)), POST(checkRequest(donor))]);
    expect(dohMocks.resolveA).toHaveBeenCalledTimes(1);

    await POST(checkRequest(donor));
    expect(dohMocks.resolveA).toHaveBeenCalledTimes(2);
  });

  it("looks up the server exit IP again after a failed lookup", async () => {
    dohMocks.resolveA.mockResolvedValue(["104.18.32.47"]);
    const exit = { country: "RU", ip: "198.51.100.7", ms: 40 };
    dohMocks.traceCountry.mockImplementation(async (ip: string) => (ip === "1.1.1.1" ? null : exit));
    await POST(checkRequest({ donor: "https://dns.example/dns-query" }));

    dohMocks.traceCountry.mockResolvedValue(exit);
    const response = await POST(checkRequest({ donor: "https://dns.example/dns-query" }));

    expect(await response.json()).toMatchObject({ chatgptMs: 40, country: null, direct: true });
  });

  it("marks a DNS without a proxy as direct and leaves the country to the browser", async () => {
    // Expire the cached server exit IP from earlier tests.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60_000);
    dohMocks.resolveA.mockResolvedValue(["104.18.32.47"]);
    // The donor's chatgpt.com connection leaves from the same IP as the server's own trace: no proxy.
    dohMocks.traceCountry.mockResolvedValue({ country: "RU", ip: "198.51.100.7", ms: 40 });

    const response = await POST(checkRequest({ donor: "https://dns.adguard-dns.com/dns-query" }));

    expect(await response.json()).toMatchObject({ dnsMs: expect.any(Number), chatgptMs: 40, country: null, direct: true });
    expect(dohMocks.traceCountry).toHaveBeenCalledWith("1.1.1.1", "one.one.one.one", 5000);
    vi.useRealTimers();
  });

  // Runs last: the checks it leaves hanging stay in flight for the rest of this file.
  it("refuses new checks while too many are running", async () => {
    dohMocks.resolveA.mockReturnValue(new Promise(() => {}));
    for (let i = 0; i < 50; i++) void POST(checkRequest({ donor: `https://dns${i}.example/dns-query` }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = await POST(checkRequest({ donor: "https://one-more.example/dns-query" }));

    expect(response.status).toBe(429);

    // Presets are still checked, so slow custom URLs cannot turn every listed donor red.
    dohMocks.resolveA.mockRejectedValue(new Error("No answer."));
    const preset = await POST(checkRequest({ donor: DNS_DONORS[0].value }));

    expect(preset.status).toBe(200);
  });
});
