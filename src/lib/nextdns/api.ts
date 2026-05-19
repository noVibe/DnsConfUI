export type NextDNSConfigResult =
  | { success: true }
  | { success: false; error: string; status?: number };

export type NextDNSValidationResult =
  | { valid: true }
  | { valid: false; error: string };

export async function validateNextDNSCredentials(
  clientId: string,
  authSecret: string
): Promise<NextDNSValidationResult> {
  try {
    const res = await fetch("/api/nextdns/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, authSecret })
    });

    const data = await res.json();
    return data;
  } catch {
    return { valid: false, error: "Failed to reach validation endpoint." };
  }
}

export async function validateCredentials(
  clientId: string,
  authSecret: string,
  provider: string
): Promise<NextDNSValidationResult> {
  const endpoint = provider === "nextdns" ? "/api/nextdns/validate" : "/api/cloudflare/validate";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, authSecret })
    });
    return await res.json();
  } catch {
    return { valid: false, error: "Failed to reach validation endpoint." };
  }
}

export async function configureNextDNSProfile(
  clientId: string,
  authSecret: string,
  blockAds: boolean,
  nativeTracking: boolean,
  disguisedTrackers: boolean
): Promise<NextDNSConfigResult> {
  try {
    const res = await fetch("/api/nextdns/configure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, authSecret, blockAds, nativeTracking, disguisedTrackers })
    });

    const data = await res.json();

    if (!data.success) {
      return { success: false, error: data.error ?? "NextDNS configuration failed.", status: res.status };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to reach NextDNS configuration endpoint."
    };
  }
}
