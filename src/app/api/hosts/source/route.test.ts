import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTS_SOURCES, type HostsSource } from "@/domain/hosts-sources";
import { POST } from "./route";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

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

function fileResponse(text: string) {
  return new Response(text, { status: 200, headers: { "Content-Type": "text/plain" } });
}

/** A body that never ends, to show the size cap stops reading instead of buffering it. */
function endlessResponse(chunkBytes = 1024 * 1024) {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(chunkBytes));
    }
  });
  return { response: { ok: true, status: 200, headers: new Headers(), body } as unknown as Response, pulls: () => pulls };
}

function requestedUrls() {
  return fetchMock.mock.calls.map(([url]) => url);
}

describe("POST /api/hosts/source", () => {
  beforeEach(() => {
    fetchMock.mockReset();
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["https://127.0.0.1/hosts.txt", "https://10.0.0.5/hosts.txt", "https://169.254.169.254/latest", "https://[::1]/hosts.txt"])(
    "refuses to download %s",
    async (url) => {
      const response = await POST(sourceRequest({ url }));

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("downloads a known source and reports the address it used", async () => {
    fetchMock.mockResolvedValue(fileResponse(HOSTS_FILE));

    const response = await POST(sourceRequest({ source: primary.key }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: HOSTS_FILE, url: primary.url });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("downloads a custom HTTPS address", async () => {
    fetchMock.mockResolvedValue(fileResponse(HOSTS_FILE));

    const response = await POST(sourceRequest({ url: CUSTOM_URL }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: HOSTS_FILE, url: CUSTOM_URL });
  });

  it.runIf(mirrored !== undefined)("falls back to the mirror when the primary address fails", async () => {
    const source = mirrored!;
    fetchMock.mockImplementation(async (url: string) =>
      url === source.url ? new Response("down", { status: 500 }) : fileResponse(HOSTS_FILE));

    const response = await POST(sourceRequest({ source: source.key }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: HOSTS_FILE, url: source.mirror });
    expect(requestedUrls()).toEqual([source.url, source.mirror]);
  });

  it("follows a redirect and reports the address the file came from", async () => {
    const target = "https://198.51.100.7/hosts.txt";
    fetchMock.mockImplementation(async (url: string) =>
      url === CUSTOM_URL ? new Response(null, { status: 302, headers: { location: target } }) : fileResponse(HOSTS_FILE));

    const response = await POST(sourceRequest({ url: CUSTOM_URL }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: HOSTS_FILE, url: target });
    expect(requestedUrls()).toEqual([CUSTOM_URL, target]);
  });

  it("rejects a body over the size cap without reading all of it", async () => {
    const endless = endlessResponse();
    fetchMock.mockResolvedValue(endless.response);

    const response = await POST(sourceRequest({ url: CUSTOM_URL }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: expect.stringContaining("4 MB") });
    // 4 MB of 1 MB chunks, plus the one that crossed the cap.
    expect(endless.pulls()).toBeLessThanOrEqual(6);
  });

  it("reports an upstream error status", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));

    const response = await POST(sourceRequest({ url: CUSTOM_URL }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.stringContaining("404") });
  });

  it("reports an unreachable address", async () => {
    fetchMock.mockRejectedValue(new Error("ETIMEDOUT"));

    const response = await POST(sourceRequest({ url: CUSTOM_URL }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it("shares one download between concurrent requests for the same file", async () => {
    fetchMock.mockResolvedValue(fileResponse(HOSTS_FILE));

    const [first, second] = await Promise.all([POST(sourceRequest({ url: CUSTOM_URL })), POST(sourceRequest({ url: CUSTOM_URL }))]);

    expect(await first.json()).toEqual(await second.json());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
