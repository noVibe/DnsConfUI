import { NextResponse } from "next/server";
import { z } from "zod";
import { isCheckableDonor } from "@/domain/dns-donors";
import { hostFamily, isIpv4Address, isResolvableHostname } from "@/domain/hosts";
import { isPublicAddress, resolveA } from "@/lib/dns/doh";
import { probeHost } from "@/lib/dns/probe";

const DNS_TIMEOUT_MS = 5000;
const PROBE_TIMEOUT_MS = 5000;
const MAX_DONORS = 11;
const MAX_HOSTNAMES = 50;
const MAX_CANDIDATES = 8;
/** How many addresses are carried for one site: the one it settled on, and one for the names that refuse it. */
const MAX_SITE_ADDRESSES = 2;
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
  hostnames: z.array(z.string().max(MAX_NAME_LENGTH)).min(1).max(MAX_HOSTNAMES),
  /**
   * Addresses a site has already been settled on, as `family -> IPv4`, for sites whose names did not all fit in
   * one batch. A pin is a preference and not an answer: the address is still probed against each hostname that
   * would use it, and a hostname it does not serve falls back to the ordinary walk through the donors.
   */
  pinned: z.record(z.string().max(MAX_NAME_LENGTH), z.string().refine(isIpv4Address)).optional()
});

/**
 * The address that answered for this hostname, its handshake time and the donor that supplied it.
 *
 * An address with no donor is one this hostname took from its own site rather than from a resolver: nobody was
 * asked for it, and the caller credits it to whoever supplied that site's address to begin with.
 */
type Resolved = { hostname: string; ip: string | null; ms: number | null; donor: string | null };

/**
 * Per-request knowledge about the donors and the proxy addresses they hand out.
 *
 * A failed probe is cached: an address that does not complete a handshake is dead regardless of hostname, so later
 * hostnames skip it. A successful one is not, because a proxy may serve one domain and not another and the
 * certificate check is per hostname; the counts only decide which candidate is tried first.
 *
 * Donors are scored the same way and for the same reason, one step up: a donor that has been supplying working
 * addresses for this batch is asked before one that has been failing on it, so the names later in the batch stop
 * paying for a walk the earlier ones already showed to be fruitless. A donor is only reordered, never skipped —
 * donors do not cover the same domains — and an untried donor sits at zero, ahead of any donor that has missed.
 */
class AddressRecord {
  private readonly dead = new Set<string>();
  private readonly score = new Map<string, number>();
  private readonly donors = new Map<string, number>();

  donorSupplied(donor: string) {
    this.donors.set(donor, (this.donors.get(donor) ?? 0) + 1);
  }

  donorMissed(donor: string) {
    this.donors.set(donor, (this.donors.get(donor) ?? 0) - 1);
  }

  /** Donors with the better record in this request first, so a hostname's walk usually ends at the first one. */
  rankDonors(donors: readonly string[]): string[] {
    return [...donors].sort((a, b) => (this.donors.get(b) ?? 0) - (this.donors.get(a) ?? 0));
  }

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

/**
 * The address for one hostname: the site's address first if it already has one, otherwise the walk through the
 * donors until an address answers for this name.
 *
 * `preferred` is what keeps a site's subdomains together. It is tried before any DNS is asked, and it is accepted
 * on exactly the same terms as an address a donor hands over - a completed handshake whose certificate is valid
 * for this hostname - so a proxy that fronts the site but not this particular name simply fails the check and the
 * walk goes ahead as usual. When it is accepted nothing is asked of DNS at all, which is also why it is quick.
 */
async function resolveHostname(
  hostname: string,
  donors: string[],
  record: AddressRecord,
  preferred: readonly string[] = []
): Promise<Resolved> {
  // Nothing to ask a public resolver: a single label, an empty string or an over-long label. It keeps its place in
  // the answer with no address, exactly like a name every donor failed on.
  if (!isResolvableHostname(hostname)) return unresolved(hostname);

  for (const address of preferred) {
    if (!isPublicAddress(address) || record.isDead(address)) continue;
    const probe = await probeHost(address, hostname, PROBE_TIMEOUT_MS);
    if (probe?.authorized) {
      record.succeeded(address);
      // No donor was asked for this one, so none is named: the caller attributes it to whoever supplied the
      // address for the site in the first place.
      return { hostname, ip: address, ms: probe.ms, donor: null };
    }
    // Reachable but serving something else is this hostname's problem alone; unreachable is everyone's.
    record.failed(address, probe !== null);
  }

  for (const donor of record.rankDonors(donors)) {
    let answers: string[];
    try {
      answers = await resolveA(donor, hostname, DNS_TIMEOUT_MS);
    } catch {
      record.donorMissed(donor);
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
      record.donorSupplied(donor);
      return { hostname, ip, ms: probe.ms, donor };
    }
    // Answered but nothing usable came of it, which for this hostname is the same as not answering.
    record.donorMissed(donor);
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

/**
 * Resolves a batch so that a site's hostnames end up on one proxy address wherever that address will serve them.
 *
 * Sending `www.example.com` through one proxy and `api.example.com` through another splits a single site across
 * two exits, which costs it a second set of connections and can look to the site like two different visitors. So
 * the batch is resolved in two passes rather than as a flat list of names: first one name per site - the shortest,
 * which is the site itself where the list carries it - and then every remaining name with its site's address
 * already in hand to try first. Both passes are pooled as before, so a site with two hundred names is no slower
 * than the same names scattered across sites.
 *
 * A site whose address the caller already knows, from an earlier batch, skips the first pass entirely.
 */
function resolveBatch(donors: string[], hostnames: string[], pinned: ReadonlyMap<string, string>): Promise<Resolved[]> {
  const record = new AddressRecord();
  const sites = new Map<string, string[]>([...pinned].map(([family, ip]) => [family, [ip]]));

  const byFamily = new Map<string, number[]>();
  hostnames.forEach((hostname, index) => {
    const family = hostFamily(hostname);
    const indices = byFamily.get(family);
    if (indices) indices.push(index);
    else byFamily.set(family, [index]);
  });

  const first: number[] = [];
  const rest: number[] = [];
  for (const [family, indices] of byFamily) {
    if (sites.has(family)) {
      rest.push(...indices);
      continue;
    }
    // The shortest name of a site is its apex when the list carries one, and otherwise the name closest to it.
    const anchor = indices.reduce((best, index) =>
      hostnames[index].length < hostnames[best].length ? index : best
    );
    first.push(anchor);
    rest.push(...indices.filter((index) => index !== anchor));
  }

  const results = new Array<Resolved>(hostnames.length);
  /**
   * Keeps what a site is known to answer on, best first, for the names of it still to come.
   *
   * A second address is worth keeping because some sites really are fronted per subdomain: when the address the
   * site settled on turns out not to serve a name, the address that did serve it is the next name's best guess,
   * so a site that cannot be held on one proxy is at least held on two instead of scattering over every name.
   */
  const remember = (index: number, row: Resolved) => {
    results[index] = row;
    if (row.ip === null) return;
    const family = hostFamily(hostnames[index]);
    const known = sites.get(family);
    if (!known) sites.set(family, [row.ip]);
    else if (!known.includes(row.ip) && known.length < MAX_SITE_ADDRESSES) known.push(row.ip);
  };

  return pooled(first, POOL_SIZE, async (index) => {
    remember(index, await resolveHostname(hostnames[index], donors, record));
  })
    .then(() =>
      pooled(rest, POOL_SIZE, async (index) => {
        const known = sites.get(hostFamily(hostnames[index])) ?? [];
        remember(index, await resolveHostname(hostnames[index], donors, record, [...known]));
      })
    )
    .then(() => results);
}

// Concurrent requests for the same batch share one run, so a retrying client cannot multiply outbound connections.
const inFlight = new Map<string, Promise<Resolved[]>>();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Send up to 11 DoH URLs and up to 50 hostnames." }, { status: 400 });
  }

  const { donors, hostnames, pinned } = parsed.data;
  const sites = new Map(Object.entries(pinned ?? {}));
  const key = JSON.stringify([donors, hostnames, [...sites]]);
  let pending = inFlight.get(key);
  if (!pending) {
    if (inFlight.size >= MAX_IN_FLIGHT) {
      return NextResponse.json({ error: "Too many batches at once. Try again shortly." }, { status: 429 });
    }
    pending = resolveBatch(donors, hostnames, sites).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  return NextResponse.json({ results: await pending });
}
