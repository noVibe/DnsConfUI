import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hostsSourceUrls, isHostsSourceKey } from "@/domain/hosts-sources";
import { isPublicAddress, publicLookup } from "@/lib/dns/doh";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 3;
const MAX_IN_FLIGHT = 20;

// Any HTTPS file URL a user wants to try; the address it resolves to is checked separately.
function isFetchableUrl(value: string): boolean {
  if (value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

const requestSchema = z.union([
  z.object({ source: z.string().refine(isHostsSourceKey) }),
  z.object({ url: z.string().refine(isFetchableUrl) })
]);

type SourceFile = { text: string; url: string };
type Failure = { status: number; error: string };

const UNREACHABLE: Failure = { status: 502, error: "Could not download the file. Check the address or try again." };
const OVERSIZE: Failure = { status: 413, error: "That file is larger than 4 MB, so it is not a hosts file." };

class OversizeError extends Error {}

/**
 * Reads the body while counting bytes, so an endless or oversized response is dropped instead of being buffered:
 * the real lists are 137 KB and 12 KB.
 */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new OversizeError();
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

// Redirects are followed by hand so every hop is checked: a public host must not be able to forward us inwards.
async function assertPublicHost(hostname: string): Promise<void> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal)) {
    if (!isPublicAddress(literal)) throw new Error(`${literal} is not a public address.`);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    publicLookup(literal, { all: true }, (error) => (error ? reject(error) : resolve()));
  });
}

/** `guard` is on for user-supplied URLs; the registry entries are constants in this app. */
async function download(target: string, guard: boolean): Promise<SourceFile | Failure> {
  let current = target;
  for (let hop = 0; ; hop++) {
    if (!isFetchableUrl(current)) return { status: 400, error: "Only HTTPS addresses without credentials can be downloaded." };
    if (guard) {
      try {
        await assertPublicHost(new URL(current).hostname);
      } catch {
        return { status: 400, error: "That address points to a private network." };
      }
    }

    let response: Response;
    try {
      response = await fetch(current, {
        headers: { accept: "text/plain, */*" },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch {
      return UNREACHABLE;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location || hop >= MAX_REDIRECTS) return UNREACHABLE;
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { status: 502, error: `The server answered ${response.status} for that file.` };
    }

    try {
      return { text: await readCapped(response), url: current };
    } catch (error) {
      return error instanceof OversizeError ? OVERSIZE : UNREACHABLE;
    }
  }
}

async function loadSource(body: z.infer<typeof requestSchema>): Promise<SourceFile | Failure> {
  if ("url" in body) return download(body.url, true);

  // The schema already refused unknown keys, so the primary URL and any mirror are there.
  const targets = hostsSourceUrls(body.source);
  let failure: Failure = UNREACHABLE;
  for (const target of targets) {
    const result = await download(target, false);
    if ("text" in result) return result;
    failure = result;
  }
  return failure;
}

// Concurrent requests for the same file share one download, so repeated calls cannot multiply outbound traffic.
const inFlight = new Map<string, Promise<SourceFile | Failure>>();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a known hosts list or enter an HTTPS file address." }, { status: 400 });
  }

  const key = "url" in parsed.data ? `url:${parsed.data.url}` : `source:${parsed.data.source}`;
  let pending = inFlight.get(key);
  if (!pending) {
    if (inFlight.size >= MAX_IN_FLIGHT) {
      return NextResponse.json({ error: "Too many downloads at once. Try again shortly." }, { status: 429 });
    }
    pending = loadSource(parsed.data).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  const result = await pending;
  return "text" in result ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.status });
}
