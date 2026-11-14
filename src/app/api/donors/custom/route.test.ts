import { describe, expect, it } from "vitest";
import { DNS_DONORS } from "@/domain/dns-donors";
import { DELETE, GET, POST } from "./route";

const OWN = "https://dns.example.net/dns-query";
const OTHER = "https://doh.example.org/dns-query";

function addRequest(body: unknown) {
  return new Request("http://localhost/api/donors/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function removeRequest(body: unknown) {
  return new Request("http://localhost/api/donors/custom", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function listed() {
  return (await (await GET()).json()).donors;
}

// The route keeps its list in module state on purpose - it lives as long as the container does - so these run in
// order against one list, the way the app's own requests do.
describe("/api/donors/custom", () => {
  it("starts with nothing kept", async () => {
    expect(await listed()).toEqual([]);
  });

  it.each([
    {},
    { url: OWN },
    { label: "Mine" },
    { url: OWN, label: "" },
    { url: OWN, label: "   " },
    { url: OWN, label: "x".repeat(25) },
    { url: "dns.example.net", label: "Mine" },
    { url: "http://dns.example.net/dns-query", label: "Mine" },
    { url: "https://user:pass@dns.example.net/dns-query", label: "Mine" },
    // A preset is already in the list; adding it again would put the same server in twice.
    { url: DNS_DONORS[0].value, label: "Mine" },
    "}{"
  ])("refuses %j", async (body) => {
    const response = await POST(addRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(await listed()).toEqual([]);
  });

  it("keeps an address under the name it was given", async () => {
    const response = await POST(addRequest({ url: OWN, label: "  Mine  " }));

    expect(response.status).toBe(200);
    // The name is trimmed, because it is what the table column shows.
    expect(await response.json()).toEqual({ donors: [{ label: "Mine", value: OWN }] });
    expect(await listed()).toEqual([{ label: "Mine", value: OWN }]);
  });

  it("answers the same list when the same address is added again", async () => {
    const response = await POST(addRequest({ url: OWN, label: "Another name" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ donors: [{ label: "Mine", value: OWN }] });
  });

  it("keeps a second address alongside the first", async () => {
    await POST(addRequest({ url: OTHER, label: "Other" }));

    expect(await listed()).toEqual([
      { label: "Mine", value: OWN },
      { label: "Other", value: OTHER }
    ]);
  });

  it.each([{}, { url: 7 }, "}{"])("refuses the removal %j", async (body) => {
    const response = await DELETE(removeRequest(body));

    expect(response.status).toBe(400);
    expect(await listed()).toHaveLength(2);
  });

  it("removes the address it is given and leaves the rest", async () => {
    const response = await DELETE(removeRequest({ url: OWN }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ donors: [{ label: "Other", value: OTHER }] });
  });

  it("answers the same list when that address was not kept", async () => {
    const response = await DELETE(removeRequest({ url: OWN }));

    expect(response.status).toBe(200);
    expect(await listed()).toEqual([{ label: "Other", value: OTHER }]);
  });
});
