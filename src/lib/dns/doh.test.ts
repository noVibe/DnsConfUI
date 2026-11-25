import { describe, expect, it } from "vitest";
import { encodeAQuery, isPublicAddress, parseARecordResponse, parseARecords, parseTrace, resolveA, resolveBatchA } from "./doh";

function answer(type: number, data: number[]) {
  // Name as a compression pointer to the question at offset 12, class IN, TTL 60.
  return [0xc0, 12, 0, type, 0, 1, 0, 0, 0, 60, 0, data.length, ...data];
}

function response(answers: number[][], rcode = 0) {
  const question = [...encodeAQuery("chatgpt.com").subarray(12)];
  return Buffer.from([0, 0, 0x81, 0x80 | rcode, 0, 1, 0, answers.length, 0, 0, 0, 0, ...question, ...answers.flat()]);
}

describe("encodeAQuery", () => {
  it("encodes the name as length-prefixed labels with an A/IN question", () => {
    expect([...encodeAQuery("chatgpt.com").subarray(12)]).toEqual([
      7, ...Buffer.from("chatgpt"), 3, ...Buffer.from("com"), 0, 0, 1, 0, 1
    ]);
  });
});

describe("parseARecords", () => {
  it("returns IPv4 addresses and skips other record types", () => {
    const cname = answer(5, [0xc0, 12]);
    expect(parseARecords(response([cname, answer(1, [1, 2, 3, 4]), answer(1, [5, 6, 7, 8])])))
      .toEqual(["1.2.3.4", "5.6.7.8"]);
  });

  it("returns no addresses for an empty answer", () => {
    expect(parseARecords(response([]))).toEqual([]);
  });

  it("rejects DNS error codes", () => {
    expect(() => parseARecords(response([], 3))).toThrow("DNS error code 3");
  });

  it("exposes RCODE in parseARecordResponse so batch lookups treat NXDOMAIN distinctly from malformed packets", () => {
    expect(parseARecordResponse(response([answer(1, [1, 2, 3, 4])], 0))).toEqual({ rcode: 0, addresses: ["1.2.3.4"] });
    expect(parseARecordResponse(response([], 3))).toEqual({ rcode: 3, addresses: [] });
    expect(parseARecordResponse(response([], 2))).toEqual({ rcode: 2, addresses: [] });
    // Query packet (QR=0) is rejected as invalid response.
    expect(() => parseARecordResponse(encodeAQuery("chatgpt.com"))).toThrow("Invalid DNS response");
  });

  it("rejects truncated and non-DNS payloads instead of looping", () => {
    const full = response([answer(1, [1, 2, 3, 4])]);
    expect(() => parseARecords(full.subarray(0, full.length - 2))).toThrow("Truncated");
    expect(() => parseARecords(Buffer.from("<html><body>505</body></html>"))).toThrow();
    expect(() => parseARecords(Buffer.alloc(4))).toThrow("too short");
  });
});

describe("parseTrace", () => {
  const trace = (status: string, body: string) => `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\n\r\n${body}`;

  it("returns the visitor country and IP from a successful trace", () => {
    expect(parseTrace(trace("200 OK", "fl=1\nip=203.0.113.7\nloc=NL\ntls=TLSv1.3\n"))).toEqual({ country: "NL", ip: "203.0.113.7" });
  });

  it("ignores failed responses and bodies without a country", () => {
    expect(parseTrace(trace("403 Forbidden", "loc=NL\n"))).toBeNull();
    expect(parseTrace(trace("200 OK", "fl=1\nip=203.0.113.7\n"))).toBeNull();
    expect(parseTrace("")).toBeNull();
  });
});

describe("isPublicAddress", () => {
  it("accepts routable addresses", () => {
    expect(isPublicAddress("94.249.177.102")).toBe(true);
    expect(isPublicAddress("2606:4700::6810:84e5")).toBe(true);
  });

  it("rejects loopback, private, link-local, CGNAT and mapped internal addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not-an-ip"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});

describe("resolveA", () => {
  it("refuses DoH servers on non-public addresses before sending anything", async () => {
    await expect(resolveA("https://127.0.0.1/dns-query", "chatgpt.com", 1000)).rejects.toThrow("not public");
    await expect(resolveA("https://[::1]/dns-query", "chatgpt.com", 1000)).rejects.toThrow("not public");
    await expect(resolveA("https://localhost/dns-query", "chatgpt.com", 1000)).rejects.toThrow("non-public");
  });
});

describe("resolveBatchA", () => {
  it("returns empty results for an empty domain list", async () => {
    const result = await resolveBatchA("https://1.1.1.1/dns-query", []);
    expect(result.records.size).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.aborted).toBe(false);
  });

  it("refuses DoH servers on non-public addresses before resolving", async () => {
    await expect(resolveBatchA("https://127.0.0.1/dns-query", ["chatgpt.com"])).rejects.toThrow("not public");
    await expect(resolveBatchA("https://[::1]/dns-query", ["chatgpt.com"])).rejects.toThrow("not public");
    await expect(resolveBatchA("https://localhost/dns-query", ["chatgpt.com"])).rejects.toThrow("non-public");
  });
});
