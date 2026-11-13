export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type DeviceTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
};

type DeviceFlowError = {
  error: "authorization_pending" | "slow_down" | "expired_token" | "access_denied" | string;
  error_description?: string;
};

const githubHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json"
};

/**
 * `clientId` is the OAuth App to authorize with when the user named one of
 * their own in the UI. An empty string means the one this build was given, so
 * the routes stay the only place that knows what that is.
 */
export async function requestGitHubDeviceCode(clientId = ""): Promise<DeviceCodeResponse> {
  const response = await fetch("/api/github/device/code", {
    method: "POST",
    headers: githubHeaders,
    body: JSON.stringify({ client_id: clientId })
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Unable to start GitHub device authorization."));
  }

  return response.json();
}

/** The device code has to be redeemed with the same app that issued it, hence the same `clientId`. */
export async function pollGitHubDeviceToken(
  deviceCode: string,
  clientId = ""
): Promise<DeviceTokenResponse | DeviceFlowError> {
  const response = await fetch("/api/github/device/token", {
    method: "POST",
    headers: githubHeaders,
    body: JSON.stringify({
      device_code: deviceCode,
      client_id: clientId
    })
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Unable to poll GitHub device authorization."));
  }

  return response.json();
}

export async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; message?: string };
    return data.message ?? data.error ?? fallback;
  } catch {
    return fallback;
  }
}
