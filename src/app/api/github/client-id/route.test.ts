import { beforeEach, describe, expect, it } from "vitest";
import { setStoredGitHubClientId } from "@/lib/github/client-id";
import { GET, POST } from "./route";

const OWN = "Ov23liOwnAppClientId";

function postRequest(body: unknown, site?: string) {
  return new Request("http://localhost/api/github/client-id", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(site ? { "Sec-Fetch-Site": site } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

async function stored() {
  return (await (await GET()).json()).clientId;
}

describe("/api/github/client-id", () => {
  beforeEach(() => {
    setStoredGitHubClientId("");
  });

  it("holds nothing until one is set", async () => {
    expect(await stored()).toBe("");
  });

  it("keeps the client ID it is given, for every browser that asks", async () => {
    const response = await POST(postRequest({ clientId: OWN }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clientId: OWN });
    expect(await stored()).toBe(OWN);
  });

  it("forgets it when given an empty one, which is the app's own again", async () => {
    await POST(postRequest({ clientId: OWN }));
    const response = await POST(postRequest({ clientId: "" }));

    expect(response.status).toBe(200);
    expect(await stored()).toBe("");
  });

  it.each([{}, { clientId: "not a client id" }, { clientId: 42 }, "}{"])("rejects %j", async (body) => {
    await POST(postRequest({ clientId: OWN }));

    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    // The one it was already holding is untouched by a request it refused.
    expect(await stored()).toBe(OWN);
  });

  // A page on another site can POST here without a preflight, so only our own calls may change the app.
  it("refuses a call from another site and leaves the setting alone", async () => {
    await POST(postRequest({ clientId: OWN }));

    const response = await POST(postRequest({ clientId: "Ov23liSomeoneElsesApp" }, "cross-site"));

    expect(response.status).toBe(403);
    expect(await stored()).toBe(OWN);
  });
});
