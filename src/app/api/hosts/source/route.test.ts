import { EventEmitter } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTS_SOURCES, type HostsSource } from "@/domain/hosts-sources";
import { POST } from "./route";

// The route reads `https.get` off the module at call time, so the property itself is stood in for. Replacing the
// module instead does not work for a built-in: the named export the route would import is bound before any mock.
const httpsGet = vi.fn();
vi.spyOn(https, "get").mockImplementation(httpsGet as unknown as typeof https.get);

// Public documentation addresses: literals keep the real SSRF guard in play without a DNS lookup.
const CUSTOM_URL = "https://203.0.113.9/hosts.txt";
const HOSTS_FILE = "# hosts\n203.0.113.9 claude.ai\n";

// The registry is a const tuple, so it is read through its own type to reach the optional mirror.
const sources: readonly HostsSource[] = HOSTS_SOURCES;
const primary = sources[0];
const mirrored = sources.find((source) => source.mirror);

function sourceRequest(body: unknown) {
  return new Request("http://localhost/api/hosts/source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function reply(status: number, body = "", headers: IncomingHttpHeaders = {}) {
  return Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { statusCode: status, headers });
}

function fileResponse(text: string) {
  return reply(200, text, { "content-type": "text/plain" });
}

/**
 * Stands in for https.get. Like node:net it resolves a hostname through the connection's own `lookup` option and
 * fails the request when that lookup refuses, so nothing can be delivered from an address the guard never saw.
 */
function serve(answer: (url: string) => Readable | Error) {
  httpsGet.mockImplementation((url: string, options: { lookup?: LookupFunction }, callback: (response: Readable) => void) => {
    const request = new EventEmitter();
    const deliver = () => {
      const answered = answer(url);
      if (answered instanceof Error) request.emit("error", answered);
      else callback(answered);
    };
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    // An IP literal is connected to directly; only a name goes through the lookup.
    if (options.lookup && !isIP(host)) {
      options.lookup(host, { all: true }, (error) => (error ? request.emit("error", error) : deliver()));
    } else {
      queueMicrotask(deliver);
    }
    return request;
  });
}

/** A body that never ends, to show the size cap stops reading instead of buffering it. */
function endlessResponse(chunkBytes = 1024 * 1024) {
  let pulls = 0;
  const body = new Readable({
    read() {
      pulls++;
      this.push(Buffer.alloc(chunkBytes));
    }
  });
  return { response: Object.assign(body, { statusCode: 200, headers: {} }), pulls: () => pulls };
}

function requestedUrls() {
  return httpsGet.mock.calls.map(([url]) => url);
}

describe("POST /api/hosts/source", () => {
  beforeEach(() => {
    httpsGet.mockReset();
  });

  it.each([
    {},
    { source: "definitely-not-a-source" },
    { url: "http://hosts.example/hosts.txt" },
    { url: "https://user:pass@hosts.example/hosts.txt" },
    { url: "not a url" },
    { url: `https://hosts.example/${"a".repeat(2048)}` },
    "}{"
  ])("rejects %j", async (body) => {
    const response = await POST(sourceRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(httpsGet).not.toHaveBeenCalled();
  });

  it.each(["https://127.0.0.1/hosts.txt", "https://10.0.0.5/hosts.txt", "https://169.254.169.254/latest", "https://[::1]/hosts.txt"])(
    "refuses to download %s",
    async (url) => {
      const response = await POST(sourceRequest({ url }));

      expect(response.status).toBe(400);
      expect(httpsGet).not.toHaveBeenCalled();
    }
  );

  // A name is checked by the lookup the connection itself makes, so a short TTL cannot swap in a private address.
  it("refuses a hostname that resolves to a private address when the connection is made", async () => {
    serve(() => fileResponse(HOSTS_FILE));

    const response = await POST(sourceRequest({ url: "https://localhost/hosts.txt" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it("downloads a known source and reports the address it used", async () => {
    serve(() => fileResponse(HOSTS_FILE));

    const response = await POST(sourceRequest({ source: primary.key }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: HOSTS_FILE, url: primary.url });
    expect(httpsGet).toHaveBeenCalledTimes(1);
  });

  it("downloads a custom HTTPS address", async () => {
    serve(() => fileResponse(HOSTS_FILE));

    const response = await POST(sourceRequest({ url: CUSTOM_URL }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: HOSTS_FILE, url: CUSTOM_URL });
  });

  it.runIf(mirrored !== undefined)("falls back to the mirror when the primary address fails", async () => {
    const source = mirrored!;
    serve((url) => (url === source.url ? reply(500, "down") : fileResponse(HOSTS_FILE)));

    const response = await POST(sourceRequest({ source: source.key }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: HOSTS_FILE, url: source.mirror });
    expect(requestedUrls()).toEqual([source.url, source.mirror]);
  });

  it("follows a redirect and reports the address the file came from", async () => {
    const target = "https://198.51.100.7/hosts.txt";
    serve((url) => (url === CUSTOM_URL ? reply(302, "", { location: target }) : fileResponse(HOSTS_FILE)));

    const response = await POST(sourceRequest({ url: CUSTOM_URL }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: HOSTS_FILE, url: target });
    expect(requestedUrls()).toEqual([CUSTOM_URL, target]);
  });

  it("rejects a body over the size cap without reading all of it", async () => {
    const endless = endlessResponse();
    serve(() => endless.response);

    const response = await POST(sourceRequest({ url: CUSTOM_URL }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: expect.stringContaining("4 MB") });
    // 4 MB of 1 MB chunks, plus the one that crossed the cap.
    expect(endless.pulls()).toBeLessThanOrEqual(6);
  });

  it("reports an upstream error status", async () => {
    serve(() => reply(404, "nope"));

    const response = await POST(sourceRequest({ url: CUSTOM_URL }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.stringContaining("404") });
  });

  it("reports an unreachable address", async () => {
    serve(() => new Error("ETIMEDOUT"));

    const response = await POST(sourceRequest({ url: CUSTOM_URL }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it("shares one download between concurrent requests for the same file", async () => {
    serve(() => fileResponse(HOSTS_FILE));

    const [first, second] = await Promise.all([POST(sourceRequest({ url: CUSTOM_URL })), POST(sourceRequest({ url: CUSTOM_URL }))]);

    expect(await first.json()).toEqual(await second.json());
    expect(httpsGet).toHaveBeenCalledTimes(1);
  });
});
