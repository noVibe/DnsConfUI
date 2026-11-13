import { NextResponse } from "next/server";
import { z } from "zod";
import { BLOCKED_COUNTRIES, isDnsDonorPreset } from "@/domain/dns-donors";
import { isPublicAddress, resolveA, traceCountry } from "@/lib/dns/doh";

const CHECK_HOST = "chatgpt.com";
const TIMEOUT_MS = 5000;
const MAX_IN_FLIGHT = 50;

// Presets, or any HTTPS DoH URL a user wants to try; resolveA refuses servers on non-public addresses.
function isCheckableDonor(value: string): boolean {
  if (isDnsDonorPreset(value)) return true;
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

const requestSchema = z.object({ donor: z.string().refine(isCheckableDonor) });

/**
 * Elapsed milliseconds for each passed check (null when failed) and the exit country chatgpt.com saw.
 * `direct` means the DNS does not proxy chatgpt.com: the connection leaves from wherever the user is, so the
 * country is left to the browser to fill in instead of reporting this server's own location.
 */
type CheckResult = { dnsMs: number | null; chatgptMs: number | null; country: string | null; direct: boolean };

const FAILED: CheckResult = { dnsMs: null, chatgptMs: null, country: null, direct: false };
const EXIT_IP_TTL_MS = 5 * 60_000;

// Concurrent requests for a donor share one check, so repeated calls cannot multiply outbound connections.
const inFlight = new Map<string, Promise<CheckResult>>();

let exitIp: { expires: number; ip: Promise<string | null> } | null = null;

// This server's own exit IP, as Cloudflare sees it when no proxy is involved.
function serverExitIp(): Promise<string | null> {
  if (!exitIp || exitIp.expires <= Date.now()) {
    exitIp = {
      expires: Date.now() + EXIT_IP_TTL_MS,
      ip: traceCountry("1.1.1.1", "one.one.one.one", TIMEOUT_MS).then((trace) => {
        // A failed lookup is not kept: without the IP every DNS without a proxy would pass with this server's country.
        if (!trace?.ip) exitIp = null;
        return trace?.ip ?? null;
      })
    };
  }
  return exitIp.ip;
}

async function check(donor: string): Promise<CheckResult> {
  const ownIp = serverExitIp();
  const started = Date.now();
  let addresses: string[];
  try {
    addresses = await resolveA(donor, CHECK_HOST, TIMEOUT_MS);
  } catch {
    return FAILED;
  }
  const dnsMs = Date.now() - started;

  // A custom DoH server can answer with any address, so internal ones are never contacted.
  const candidates = addresses.filter(isPublicAddress).slice(0, 4);
  const traces = candidates.map((ip) => traceCountry(ip, CHECK_HOST, TIMEOUT_MS));
  const serverIp = await ownIp;
  const isDirect = (trace: { ip: string }) => trace.ip === serverIp;
  // Settle on the first usable address instead of waiting for dead ones to time out.
  const passed = await Promise.any(traces.map(async (pending) => {
    const trace = await pending;
    if (!trace || (!isDirect(trace) && BLOCKED_COUNTRIES.has(trace.country))) throw new Error("Unusable address.");
    return trace;
  })).catch(() => null);
  if (passed) {
    const direct = isDirect(passed);
    return { dnsMs, chatgptMs: passed.ms, country: direct ? null : passed.country, direct };
  }

  const answered = (await Promise.all(traces)).find(Boolean);
  return { ...FAILED, dnsMs, country: answered?.country ?? null };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an HTTPS DoH URL." }, { status: 400 });
  }

  const { donor } = parsed.data;
  let result = inFlight.get(donor);
  if (!result) {
    // Presets are few and shared, so slow custom URLs cannot crowd them out.
    if (!isDnsDonorPreset(donor) && inFlight.size >= MAX_IN_FLIGHT) {
      return NextResponse.json({ error: "Too many checks at once. Try again shortly." }, { status: 429 });
    }
    result = check(donor).finally(() => inFlight.delete(donor));
    inFlight.set(donor, result);
  }

  return NextResponse.json(await result);
}
