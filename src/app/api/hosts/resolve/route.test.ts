import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const dohMocks = vi.hoisted(() => ({ resolveA: vi.fn() }));
const probeMocks = vi.hoisted(() => ({ probeHost: vi.fn() }));

// The address filter stays real so the test covers which addresses are probed.
vi.mock("@/lib/dns/doh", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/dns/doh")>()), ...dohMocks }));
vi.mock("@/lib/dns/probe", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/dns/probe")>()), ...probeMocks }));

const GEOHIDE = "https://geohide.ru/dns-query";
const MALW = "https://dns.malw.link/dns-query";

function resolveRequest(body: unknown) {
  return new Request("http://localhost/api/hosts/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function resolved(body: unknown) {
  const response = await POST(resolveRequest(body));
  expect(response.status).toBe(200);
  return (await response.json()).results;
}

const authorized = (ms = 70) => ({ ms, authorized: true });
const unauthorized = (ms = 70) => ({ ms, authorized: false });

function flushMacrotask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("POST /api/hosts/resolve", () => {
  beforeEach(() => {
    dohMocks.resolveA.mockReset();
    probeMocks.probeHost.mockReset();
  });

  it.each([
    {},
    { donors: [], hostnames: ["claude.ai"] },
    { donors: [GEOHIDE], hostnames: [] },
    { donors: ["http://dns.example/dns-query"], hostnames: ["claude.ai"] },
    { donors: ["https://user:pass@dns.example/dns-query"], hostnames: ["claude.ai"] },
    { donors: [`https://dns.example/${"a".repeat(2048)}`], hostnames: ["claude.ai"] },
    { donors: Array.from({ length: 12 }, (_, i) => `https://dns${i}.example/dns-query`), hostnames: ["claude.ai"] },
    { donors: [GEOHIDE], hostnames: Array.from({ length: 51 }, (_, i) => `host${i}.example`) },
    { donors: [GEOHIDE], hostnames: ["not a hostname"] },
    { donors: [GEOHIDE], hostnames: [`${"a".repeat(64)}.example`] },
    "}{"
  ])("rejects %j", async (body) => {
    const response = await POST(resolveRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(dohMocks.resolveA).not.toHaveBeenCalled();
  });

  it("returns the first address whose certificate validates for the hostname", async () => {
    dohMocks.resolveA.mockResolvedValue(["159.194.200.33", "193.233.112.68", "193.233.112.67"]);
    probeMocks.probeHost.mockImplementation(async (ip: string) => (ip === "193.233.112.67" ? authorized(120) : null));

    expect(await resolved({ donors: [GEOHIDE], hostnames: ["claude.ai"] }))
      .toEqual([{ hostname: "claude.ai", ip: "193.233.112.67", ms: 120, donor: GEOHIDE }]);
    expect(dohMocks.resolveA).toHaveBeenCalledWith(GEOHIDE, "claude.ai", 5000);
    expect(probeMocks.probeHost).toHaveBeenCalledWith("193.233.112.67", "claude.ai", 5000);
  });

  it("stops at the first donor that yields a working address", async () => {
    dohMocks.resolveA.mockResolvedValue(["203.0.113.9"]);
    probeMocks.probeHost.mockResolvedValue(authorized(55));

    expect(await resolved({ donors: [GEOHIDE, MALW], hostnames: ["claude.ai"] }))
      .toEqual([{ hostname: "claude.ai", ip: "203.0.113.9", ms: 55, donor: GEOHIDE }]);
    expect(dohMocks.resolveA).toHaveBeenCalledTimes(1);
    expect(dohMocks.resolveA).not.toHaveBeenCalledWith(MALW, expect.anything(), expect.anything());
  });

  it("falls through to the next donor when a donor answers with no addresses", async () => {
    // Measured: GeoHide returns no A records for chatgpt.com while Malw resolves it.
    dohMocks.resolveA.mockImplementation(async (donor: string) => (donor === GEOHIDE ? [] : ["203.0.113.9"]));
    probeMocks.probeHost.mockResolvedValue(authorized(350));

    expect(await resolved({ donors: [GEOHIDE, MALW], hostnames: ["chatgpt.com"] }))
      .toEqual([{ hostname: "chatgpt.com", ip: "203.0.113.9", ms: 350, donor: MALW }]);
    expect(dohMocks.resolveA.mock.calls.map(([donor]) => donor)).toEqual([GEOHIDE, MALW]);
  });

  it("falls through to the next donor when the certificate does not validate for the hostname", async () => {
    dohMocks.resolveA.mockImplementation(async (donor: string) => (donor === GEOHIDE ? ["203.0.113.9"] : ["198.51.100.7"]));
    probeMocks.probeHost.mockImplementation(async (ip: string) => (ip === "203.0.113.9" ? unauthorized() : authorized(90)));

    expect(await resolved({ donors: [GEOHIDE, MALW], hostnames: ["claude.ai"] }))
      .toEqual([{ hostname: "claude.ai", ip: "198.51.100.7", ms: 90, donor: MALW }]);
  });

  it("falls through to the next donor when a donor fails to answer at all", async () => {
    dohMocks.resolveA.mockImplementation(async (donor: string) => {
      if (donor === GEOHIDE) throw new Error("DoH request timed out.");
      return ["203.0.113.9"];
    });
    probeMocks.probeHost.mockResolvedValue(authorized(80));

    expect(await resolved({ donors: [GEOHIDE, MALW], hostnames: ["claude.ai"] }))
      .toEqual([{ hostname: "claude.ai", ip: "203.0.113.9", ms: 80, donor: MALW }]);
  });

  it("reports no address when every candidate connects but no certificate validates", async () => {
    dohMocks.resolveA.mockResolvedValue(["203.0.113.9", "198.51.100.7"]);
    probeMocks.probeHost.mockResolvedValue(unauthorized());

    expect(await resolved({ donors: [GEOHIDE, MALW], hostnames: ["claude.ai"] }))
      .toEqual([{ hostname: "claude.ai", ip: null, ms: null, donor: null }]);
    expect(probeMocks.probeHost).toHaveBeenCalledTimes(4);
  });

  it("never probes an address outside the public range", async () => {
    dohMocks.resolveA.mockResolvedValue(["10.0.0.5", "169.254.169.254", "127.0.0.1", "203.0.113.9"]);
    probeMocks.probeHost.mockResolvedValue(authorized(60));

    expect(await resolved({ donors: [GEOHIDE], hostnames: ["claude.ai"] }))
      .toEqual([{ hostname: "claude.ai", ip: "203.0.113.9", ms: 60, donor: GEOHIDE }]);
    expect(probeMocks.probeHost.mock.calls.map(([ip]) => ip)).toEqual(["203.0.113.9"]);
  });

  it("does not probe an address again once it failed to connect in this request", async () => {
    let release = () => {};
    const second = new Promise<void>((resolve) => { release = resolve; });
    dohMocks.resolveA.mockImplementation(async (_donor: string, name: string) => {
      if (name === "b.example") await second;
      return ["198.51.100.7"];
    });
    probeMocks.probeHost.mockResolvedValue(null);

    const pending = POST(resolveRequest({ donors: [GEOHIDE], hostnames: ["a.example", "b.example"] }));
    // Let the first hostname finish its probe and record the dead address before the second one gets its answer.
    await vi.waitFor(() => expect(probeMocks.probeHost).toHaveBeenCalledTimes(1));
    await flushMacrotask();
    release();

    expect((await (await pending).json()).results).toEqual([
      { hostname: "a.example", ip: null, ms: null, donor: null },
      { hostname: "b.example", ip: null, ms: null, donor: null }
    ]);
    expect(probeMocks.probeHost).toHaveBeenCalledTimes(1);
  });

  it("probes the address with the better record in this request first", async () => {
    let release = () => {};
    const second = new Promise<void>((resolve) => { release = resolve; });
    dohMocks.resolveA.mockImplementation(async (_donor: string, name: string) => {
      if (name === "a.example") return ["203.0.113.9"];
      await second;
      return ["198.51.100.7", "203.0.113.9"];
    });
    probeMocks.probeHost.mockImplementation(async (ip: string) => (ip === "203.0.113.9" ? authorized(45) : unauthorized()));

    const pending = POST(resolveRequest({ donors: [GEOHIDE], hostnames: ["a.example", "b.example"] }));
    // Let the first hostname record its working address before the second one ranks its candidates.
    await vi.waitFor(() => expect(probeMocks.probeHost).toHaveBeenCalledTimes(1));
    await flushMacrotask();
    release();
    const results = (await (await pending).json()).results;

    expect(results.map((result: { ip: string }) => result.ip)).toEqual(["203.0.113.9", "203.0.113.9"]);
    // The proxy that already served a.example is tried before the untried address b.example was answered with.
    expect(probeMocks.probeHost.mock.calls.map(([ip]) => ip)).toEqual(["203.0.113.9", "203.0.113.9"]);
  });

  it("resolves a batch through a bounded pool instead of all at once", async () => {
    const hostnames = Array.from({ length: 25 }, (_, i) => `host${i}.example`);
    const waiting: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    dohMocks.resolveA.mockImplementation(() => new Promise<string[]>((resolve) => {
      active++;
      peak = Math.max(peak, active);
      waiting.push(() => {
        active--;
        resolve(["203.0.113.9"]);
      });
    }));
    probeMocks.probeHost.mockResolvedValue(authorized(30));

    let finished = false;
    const pending = POST(resolveRequest({ donors: [GEOHIDE], hostnames })).then((response) => {
      finished = true;
      return response;
    });
    await vi.waitFor(() => expect(waiting.length).toBe(10));

    expect(peak).toBe(10);
    for (let guard = 0; guard < 40 && !finished; guard++) {
      waiting.splice(0).forEach((release) => release());
      await flushMacrotask();
    }

    expect((await (await pending).json()).results).toHaveLength(25);
    expect(peak).toBe(10);
  });

  it("shares one run between concurrent requests for the same batch", async () => {
    dohMocks.resolveA.mockResolvedValue([]);
    const body = { donors: [GEOHIDE], hostnames: ["claude.ai"] };

    await Promise.all([POST(resolveRequest(body)), POST(resolveRequest(body))]);

    expect(dohMocks.resolveA).toHaveBeenCalledTimes(1);
  });

  // Runs last: the batches it leaves hanging stay in flight for the rest of this file.
  it("refuses new batches while too many are running", async () => {
    dohMocks.resolveA.mockReturnValue(new Promise(() => {}));
    for (let i = 0; i < 10; i++) void POST(resolveRequest({ donors: [GEOHIDE], hostnames: [`host${i}.example`] }));
    await flushMacrotask();

    const response = await POST(resolveRequest({ donors: [GEOHIDE], hostnames: ["one-more.example"] }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });
});
