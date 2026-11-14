import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_GITHUB_CLIENT_ID } from "@/domain/github-app";
import { setStoredGitHubClientId } from "@/lib/github/client-id";
import { POST as requestCode } from "./code/route";
import { POST as requestToken } from "./token/route";

const fetchMock = vi.fn();
/** An OAuth App named in the UI, which this container then authorizes with until it is restarted. */
const CONTAINER_APP = "Ov23liContainerApp";

function tokenRequest(body: unknown) {
  return new Request("http://localhost/api/github/device/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The browser names the app to authorize with, or sends an empty string for "the one this container has". */
function codeRequest(body: unknown = { client_id: "" }) {
  return new Request("http://localhost/api/github/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GitHub device flow routes", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setStoredGitHubClientId(CONTAINER_APP);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setStoredGitHubClientId("");
  });

  it("falls back to the built-in client ID when the container holds none", async () => {
    setStoredGitHubClientId("");
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ device_code: "dc" }) });

    const response = await requestCode(codeRequest());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/device/code", expect.objectContaining({
      body: JSON.stringify({ client_id: BUILT_IN_GITHUB_CLIENT_ID, scope: "repo workflow read:user" }),
    }));
  });

  it("exchanges the device code with the built-in client ID when the container holds none", async () => {
    setStoredGitHubClientId("");
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ access_token: "token" }) });

    const response = await requestToken(tokenRequest({ device_code: "dc" }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/oauth/access_token", expect.objectContaining({
      body: JSON.stringify({
        client_id: BUILT_IN_GITHUB_CLIENT_ID,
        device_code: "dc",
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    }));
  });

  it("requests a device code with the required scopes", async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ device_code: "dc" }) });

    const response = await requestCode(codeRequest());

    await expect(response.json()).resolves.toEqual({ device_code: "dc" });
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/device/code", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ client_id: CONTAINER_APP, scope: "repo workflow read:user" }),
    }));
  });

  it("rejects an empty device code", async () => {
    const response = await requestToken(tokenRequest({ device_code: "" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed token JSON with status 400", async () => {
    const response = await requestToken(new Request("http://localhost/api/github/device/token", { method: "POST", body: "{" }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the token request and upstream status", async () => {
    fetchMock.mockResolvedValue({ status: 202, json: async () => ({ error: "authorization_pending" }) });

    const response = await requestToken(tokenRequest({ device_code: "dc" }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ error: "authorization_pending" });
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/oauth/access_token", expect.objectContaining({
      body: JSON.stringify({
        client_id: CONTAINER_APP,
        device_code: "dc",
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    }));
  });

  it("authorizes with the client ID the browser supplied instead of the build's", async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ device_code: "dc" }) });

    const response = await requestCode(codeRequest({ client_id: "Ov23liOwnAppClientId" }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/device/code", expect.objectContaining({
      body: JSON.stringify({ client_id: "Ov23liOwnAppClientId", scope: "repo workflow read:user" }),
    }));
  });

  it("redeems the device code with the client ID it was issued to", async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ access_token: "token" }) });

    const response = await requestToken(tokenRequest({ device_code: "dc", client_id: "Ov23liOwnAppClientId" }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/oauth/access_token", expect.objectContaining({
      body: JSON.stringify({
        client_id: "Ov23liOwnAppClientId",
        device_code: "dc",
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    }));
  });

  // Quietly falling back to the shared app would authorize against an app the user did not ask for, and the
  // mistake would surface later as a puzzling answer from GitHub rather than at the field they typed it into.
  it("refuses a supplied client ID that cannot be one, on both routes", async () => {
    const code = await requestCode(codeRequest({ client_id: "not a client id" }));
    const token = await requestToken(tokenRequest({ device_code: "dc", client_id: "not a client id" }));

    expect(code.status).toBe(400);
    expect(token.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes a request with no client ID in it as the container's own", async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ device_code: "dc" }) });

    const response = await requestCode(codeRequest({}));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://github.com/login/device/code", expect.objectContaining({
      body: JSON.stringify({ client_id: CONTAINER_APP, scope: "repo workflow read:user" }),
    }));
  });
});
