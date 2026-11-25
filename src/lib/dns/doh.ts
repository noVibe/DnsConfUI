import dns from "node:dns";
import http2 from "node:http2";
import { BlockList, isIP, type LookupFunction } from "node:net";
import tls from "node:tls";

const TYPE_A = 1;
const MAX_RESPONSE_BYTES = 64 * 1024;

const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/** False for loopback, private, link-local, multicast and other non-routable addresses. */
export function isPublicAddress(ip: string): boolean {
  const address = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] ?? ip;
  const family = isIP(address);
  return family !== 0 && !NON_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}

// Checked in the lookup the connection itself uses, so a hostname cannot pass a check and then resolve elsewhere.
const publicLookup = ((hostname, options, callback) => {
  dns.lookup(hostname, options, (error, address, family) => {
    if (error) return callback(error, address, family);
    const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
    if (!addresses.every(isPublicAddress)) return callback(new Error(`${hostname} resolves to a non-public address.`), address, family);
    callback(null, address, family);
  });
}) as LookupFunction;

export function encodeAQuery(name: string): Buffer {
  const labels = name.split(".").flatMap((label) => [label.length, ...Buffer.from(label)]);
  // ID 0 is recommended for DoH (RFC 8484), RD flag set, one question.
  return Buffer.from([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...labels, 0, 0, TYPE_A, 0, 1]);
}

function skipName(packet: Buffer, offset: number): number {
  while (offset < packet.length) {
    const length = packet[offset];
    if (length === 0) return offset + 1;
    if ((length & 0xc0) === 0xc0) return offset + 2;
    offset += length + 1;
  }
  throw new Error("Truncated DNS name.");
}

export type DnsARecordResponse = {
  rcode: number;
  addresses: string[];
};

/** Parses an A-record DNS response, returning the DNS RCODE and any IPv4 answers; throws on malformed packets. */
export function parseARecordResponse(packet: Buffer): DnsARecordResponse {
  if (packet.length < 12) throw new Error("DNS response is too short.");
  if ((packet[2] & 0x80) === 0) throw new Error("Invalid DNS response.");
  const rcode = packet[3] & 0x0f;
  if (rcode !== 0) return { rcode, addresses: [] };

  const questions = packet.readUInt16BE(4);
  const answers = packet.readUInt16BE(6);
  let offset = 12;
  for (let i = 0; i < questions; i++) offset = skipName(packet, offset) + 4;

  const addresses: string[] = [];
  for (let i = 0; i < answers; i++) {
    offset = skipName(packet, offset);
    if (offset + 10 > packet.length) throw new Error("Truncated DNS record.");
    const type = packet.readUInt16BE(offset);
    const dataLength = packet.readUInt16BE(offset + 8);
    const dataStart = offset + 10;
    if (dataStart + dataLength > packet.length) throw new Error("Truncated DNS record.");
    if (type === TYPE_A && dataLength === 4) addresses.push([...packet.subarray(dataStart, dataStart + 4)].join("."));
    offset = dataStart + dataLength;
  }
  return { rcode: 0, addresses };
}

/** Returns IPv4 addresses from the answer section; throws on malformed or error responses. */
export function parseARecords(packet: Buffer): string[] {
  const parsed = parseARecordResponse(packet);
  if (parsed.rcode !== 0) throw new Error(`DNS error code ${parsed.rcode}.`);
  return parsed.addresses;
}

// Some donors only accept DoH over HTTP/2 and answer HTTP/1.1 with 505, so fetch() is not enough.
export function resolveA(dohUrl: string, name: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const url = new URL(dohUrl);
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    // IP literals skip the lookup, so they are checked here.
    if (isIP(literal) && !isPublicAddress(literal)) return reject(new Error("DoH server address is not public."));
    const session = http2.connect(url.origin, { lookup: publicLookup });
    const fail = (error: Error) => {
      clearTimeout(timer);
      session.destroy();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error("DoH request timed out.")), timeoutMs);
    session.on("error", fail);

    const request = session.request({
      ":path": `${url.pathname}?dns=${encodeAQuery(name).toString("base64url")}`,
      accept: "application/dns-message"
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let status = 0;
    request.on("response", (headers) => { status = Number(headers[":status"]); });
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) fail(new Error("DoH response is too large."));
      else chunks.push(chunk);
    });
    request.on("error", fail);
    request.on("end", () => {
      clearTimeout(timer);
      session.close();
      if (status !== 200) return reject(new Error(`DoH responded with ${status}.`));
      try {
        resolve(parseARecords(Buffer.concat(chunks)));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export type ResolveBatchOptions = {
  concurrency?: number;
  timeoutMs?: number;
  maxConsecutiveFailures?: number;
};

export type ResolveBatchResult = {
  records: Map<string, string[]>;
  succeeded: number;
  failed: number;
  aborted: boolean;
};

const RCODE_NXDOMAIN = 3;

class DoHRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

function buildDohPath(url: URL, name: string): string {
  const sep = url.search ? "&" : "?";
  return `${url.pathname}${url.search}${sep}dns=${encodeAQuery(name).toString("base64url")}`;
}

function requestOnSession(
  session: http2.ClientHttp2Session,
  url: URL,
  name: string,
  timeoutMs: number
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (session.closed || session.destroyed) {
      return reject(new DoHRequestError("DoH session is closed.", true));
    }
    let settled = false;
    const finish = (error: Error | null, ips?: string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(ips ?? []);
    };

    let req: http2.ClientHttp2Stream;
    try {
      req = session.request({
        ":path": buildDohPath(url, name),
        accept: "application/dns-message"
      });
    } catch (error) {
      return finish(new DoHRequestError(error instanceof Error ? error.message : "DoH stream error.", true));
    }

    const timer = setTimeout(() => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      finish(new DoHRequestError("DoH request timed out.", true));
    }, timeoutMs);

    const chunks: Buffer[] = [];
    let size = 0;
    let status = 0;
    req.on("response", (headers) => {
      status = Number(headers[":status"]);
    });
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        req.close(http2.constants.NGHTTP2_CANCEL);
        finish(new DoHRequestError("DoH response is too large.", false));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("error", (error) => finish(new DoHRequestError(error instanceof Error ? error.message : "DoH stream error.", true)));
    req.on("aborted", () => finish(new DoHRequestError("DoH stream aborted.", true)));
    req.on("close", () => finish(new DoHRequestError("DoH stream closed unexpectedly.", true)));
    req.on("end", () => {
      if (status !== 200) {
        const retryable = status >= 500 || status === 429 || status === 0;
        return finish(new DoHRequestError(`DoH responded with ${status}.`, retryable));
      }
      try {
        const parsed = parseARecordResponse(Buffer.concat(chunks));
        // NXDOMAIN is a valid negative answer from a healthy donor, not a transport/donor failure.
        if (parsed.rcode === 0) return finish(null, parsed.addresses);
        if (parsed.rcode === RCODE_NXDOMAIN) return finish(null, []);
        return finish(new DoHRequestError(`DNS error code ${parsed.rcode}.`, false));
      } catch (error) {
        finish(new DoHRequestError(error instanceof Error ? error.message : "Failed to parse DNS response.", false));
      }
    });
  });
}

/**
 * Resolves a batch of domain names over a multiplexed HTTP/2 DoH session, filtering to public IPv4 addresses.
 * Trips a circuit breaker if the donor fails consecutively so unreachable donors abort quickly.
 */
export async function resolveBatchA(
  dohUrl: string,
  domains: readonly string[],
  options: ResolveBatchOptions = {}
): Promise<ResolveBatchResult> {
  const url = new URL(dohUrl);
  if (url.protocol !== "https:") {
    throw new Error("DoH server must use HTTPS.");
  }
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal)) {
    if (!isPublicAddress(literal)) {
      throw new Error("DoH server address is not public.");
    }
  } else {
    const lookedUp = await dns.promises.lookup(literal, { all: true });
    if (lookedUp.length === 0 || !lookedUp.every((entry) => isPublicAddress(entry.address))) {
      throw new Error(`${literal} resolves to a non-public address.`);
    }
  }

  const uniqueDomains = [...new Set(domains)];
  const records = new Map<string, string[]>();
  if (uniqueDomains.length === 0) {
    return { records, succeeded: 0, failed: 0, aborted: false };
  }

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 16, uniqueDomains.length));
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 12;

  const sessionState: { current: http2.ClientHttp2Session | null } = { current: null };
  let sessionReconnects = 0;
  const MAX_RECONNECTS = 15;

  function getSession(): http2.ClientHttp2Session {
    if (sessionState.current && !sessionState.current.closed && !sessionState.current.destroyed) {
      return sessionState.current;
    }
    if (sessionReconnects >= MAX_RECONNECTS) {
      throw new DoHRequestError("DoH session failed too many times.", false);
    }
    sessionReconnects++;
    const next = http2.connect(url.origin, { lookup: publicLookup });
    next.on("error", () => {
      if (sessionState.current === next) sessionState.current = null;
    });
    next.on("goaway", () => {
      if (sessionState.current === next) sessionState.current = null;
      next.close();
    });
    next.on("close", () => {
      if (sessionState.current === next) sessionState.current = null;
    });
    sessionState.current = next;
    return next;
  }

  let cursor = 0;
  let succeeded = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let aborted = false;

  async function worker() {
    while (!aborted) {
      const idx = cursor++;
      if (idx >= uniqueDomains.length) return;
      const domain = uniqueDomains[idx];
      try {
        let ips: string[];
        let session = getSession();
        try {
          ips = await requestOnSession(session, url, domain, timeoutMs);
        } catch (error) {
          // Retry once only on retryable transport/HTTP errors, never on protocol/DNS answers.
          if (aborted || !(error instanceof DoHRequestError && error.retryable)) {
            throw error;
          }
          if (sessionState.current === session && (session.closed || session.destroyed)) {
            sessionState.current = null;
          }
          session = getSession();
          ips = await requestOnSession(session, url, domain, timeoutMs);
        }
        const publicIps = [...new Set(ips.filter(isPublicAddress))];
        records.set(domain, publicIps);
        succeeded++;
        consecutiveFailures = 0;
      } catch {
        failed++;
        consecutiveFailures++;
        if (consecutiveFailures >= maxConsecutiveFailures) {
          aborted = true;
        }
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    if (sessionState.current && !sessionState.current.destroyed) {
      sessionState.current.close();
    }
  }

  return { records, succeeded, failed, aborted };
}

/** Extracts the visitor country and IP from a raw Cloudflare /cdn-cgi/trace HTTP response. */
export function parseTrace(response: string): { country: string; ip: string } | null {
  if (!/^HTTP\/1\.[01] 200 /.test(response)) return null;
  const country = /^loc=([A-Z]{2})\r?$/m.exec(response)?.[1];
  const ip = /^ip=([\da-fA-F.:]+)\r?$/m.exec(response)?.[1];
  return country && ip ? { country, ip } : null;
}

type Trace = { country: string; ip: string; ms: number };

/**
 * Requests https://{host}/cdn-cgi/trace from `ip` (valid certificate required) and returns the country and IP
 * Cloudflare sees the connection coming from, which is the proxy exit when the donor proxies the host.
 */
export function traceCountry(ip: string, host: string, timeoutMs: number): Promise<Trace | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = tls.connect({ host: ip, port: 443, servername: host, ALPNProtocols: ["http/1.1"] });
    // The socket idle timeout does not always fire while connecting, so a hard deadline is used.
    const timer = setTimeout(() => finish(null), timeoutMs);
    let response = "";
    function finish(result: Trace | null) {
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    }
    socket.setEncoding("utf8");
    socket.once("secureConnect", () => {
      socket.write(`GET /cdn-cgi/trace HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", (chunk: string) => {
      response += chunk;
      if (response.length > MAX_RESPONSE_BYTES) finish(null);
    });
    socket.once("end", () => {
      const trace = parseTrace(response);
      finish(trace ? { ...trace, ms: Date.now() - started } : null);
    });
    socket.once("error", () => finish(null));
  });
}
