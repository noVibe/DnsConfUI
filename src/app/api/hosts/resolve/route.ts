import { NextResponse } from "next/server";
import { z } from "zod";
import { isCheckableDonor } from "@/domain/dns-donors";
import { isResolvableHostname } from "@/domain/hosts";
import { isPublicAddress, resolveA } from "@/lib/dns/doh";
import { probeHost } from "@/lib/dns/probe";

const DNS_TIMEOUT_MS = 5000;
const PROBE_TIMEOUT_MS = 5000;
const MAX_DONORS = 11;
const MAX_HOSTNAMES = 50;
const MAX_CANDIDATES = 8;
const POOL_SIZE = 10;
const MAX_IN_FLIGHT = 10;
/** No DNS name is longer than this, so a longer string is not a name at all. */
const MAX_NAME_LENGTH = 253;

/**
 * The shape of the request is strict, but a single hostname inside it is not: a batch carries up to 50 names, and
 * one odd entry in an uploaded list must not cost the other 49 their answer. A name this route cannot ask a
 * resolver about is reported as unresolved in `results` instead (see `resolveHostname`).
 */
const requestSchema = z.object({
  donors: z.array(z.string().refine(isCheckableDonor)).min(1).max(MAX_DONORS),
  hostnames: z.array(z.string().max(MAX_NAME_LENGTH)).min(1).max(MAX_HOSTNAMES)
});

/** The address that answered for this hostname, its handshake time and the donor that supplied it. */
type Resolved = { hostname: string; ip: string | null; ms: number | null; donor: string | null };

/**
 * Per-request knowledge about the proxy addresses the donors hand out.
 *
 * A failed probe is cached: an address that does not complete a handshake is dead regardless of hostname, so later
 * hostnames skip it. A successful one is not, because a proxy may serve one domain and not another and the
 * certificate check is per hostname; the counts only decide which candidate is tried first.
 */
class AddressRecord {
  private readonly dead = new Set<string>();
  private readonly score = new Map<string, number>();

  isDead(ip: string): boolean {
    return this.dead.has(ip);
  }

  succeeded(ip: string) {
    this.score.set(ip, (this.score.get(ip) ?? 0) + 1);
  }

  failed(ip: string, reachable: boolean) {
    if (!reachable) this.dead.add(ip);
    this.score.set(ip, (this.score.get(ip) ?? 0) - 1);
  }

  /** Addresses with the better record first, so a known-good proxy costs a single handshake. */
  rank(addresses: string[]): string[] {
    return [...addresses].sort((a, b) => (this.score.get(b) ?? 0) - (this.score.get(a) ?? 0));
  }
}

const unresolved = (hostname: string): Resolved => ({ hostname, ip: null, ms: null, donor: null });

async function resolveHostname(hostname: string, donors: string[], record: AddressRecord): Promise<Resolved> {
  // Nothing to ask a public resolver: a single label, an empty string or an over-long label. It keeps its place in
  // the answer with no address, exactly like a name every donor failed on.
  if (!isResolvableHostname(hostname)) return unresolved(hostname);

  for (const donor of donors) {
    let answers: string[];
    try {
      answers = await resolveA(donor, hostname, DNS_TIMEOUT_MS);
    } catch {
      continue;
    }
    // Some donors answer with no A records for a name another donor resolves, which is why the walk exists:
    // an empty or unusable answer falls through to the next donor instead of failing the hostname.
    const candidates = record
      .rank(answers.filter((ip) => isPublicAddress(ip) && !record.isDead(ip)))
      .slice(0, MAX_CANDIDATES);

    // One handshake at a time, stopping at the first address whose certificate validates for this hostname.
    for (const ip of candidates) {
      const probe = await probeHost(ip, hostname, PROBE_TIMEOUT_MS);
      if (!probe) {
        record.failed(ip, false);
        continue;
      }
      if (!probe.authorized) {
        record.failed(ip, true);
        continue;
      }
      record.succeeded(ip);
      return { hostname, ip, ms: probe.ms, donor };
    }
  }
  return unresolved(hostname);
}

// A fixed number of workers share the queue: a batch of 50 names never opens 50 DoH sessions at once.
async function pooled<T, R>(items: readonly T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

function resolveBatch(donors: string[], hostnames: string[]): Promise<Resolved[]> {
  const record = new AddressRecord();
  return pooled(hostnames, POOL_SIZE, (hostname) => resolveHostname(hostname, donors, record));
}

// Concurrent requests for the same batch share one run, so a retrying client cannot multiply outbound connections.
const inFlight = new Map<string, Promise<Resolved[]>>();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Send up to 11 DoH URLs and up to 50 hostnames." }, { status: 400 });
  }

  const { donors, hostnames } = parsed.data;
  const key = JSON.stringify([donors, hostnames]);
  let pending = inFlight.get(key);
  if (!pending) {
    if (inFlight.size >= MAX_IN_FLIGHT) {
      return NextResponse.json({ error: "Too many batches at once. Try again shortly." }, { status: 429 });
    }
    pending = resolveBatch(donors, hostnames).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  return NextResponse.json({ results: await pending });
}
