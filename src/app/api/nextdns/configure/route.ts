import { NextResponse } from "next/server";
import { z } from "zod";
import { ADS_BLOCKLIST_IDS, NATIVE_TRACKING_IDS } from "@/domain/toggles";

const requestSchema = z.object({
  clientId: z.string().min(1),
  authSecret: z.string().min(1),
  blockAds: z.boolean(),
  nativeTracking: z.boolean(),
  disguisedTrackers: z.boolean()
});

async function apiFetch(
  clientId: string,
  authSecret: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ success: true } | { success: false; error: string; status?: number }> {
  try {
    const res = await fetch(`https://api.nextdns.io${path}`, {
      method,
      headers: {
        "X-Api-Key": authSecret,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (res.ok || res.status === 204) {
      return { success: true };
    }

    const text = await res.text().catch(() => "");
    const detail = text ? `: ${text.substring(0, 200)}` : "";
    return { success: false, error: `NextDNS API error (${res.status})${detail}`, status: res.status };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error connecting to NextDNS API"
    };
  }
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { clientId, authSecret, blockAds, nativeTracking, disguisedTrackers } = parsed.data;

  if (!blockAds && !nativeTracking && !disguisedTrackers) {
    return NextResponse.json({ success: true });
  }

  const profilePatch: Record<string, unknown> = {};

  if (disguisedTrackers) {
    profilePatch.privacy = { disguisedTrackers: true };
  }

  if (blockAds) {
    profilePatch.privacy = {
      ...(profilePatch.privacy as object || {}),
      disguisedTrackers: true,
      blocklists: ADS_BLOCKLIST_IDS.map(id => ({ id }))
    };
    profilePatch.security = {
      threatIntelligenceFeeds: true,
      aiThreatDetection: true,
      googleSafeBrowsing: true,
      cryptojacking: true,
      dnsRebinding: true,
      idnHomographs: true,
      typosquatting: true,
      dga: true,
      nrd: true,
      ddns: true,
      parking: true,
      csam: true
    };
  }

  if (Object.keys(profilePatch).length > 0) {
    const result = await apiFetch(clientId, authSecret, "PATCH", `/profiles/${clientId}`, profilePatch);
    if (!result.success) {
      return NextResponse.json(result, { status: result.status ?? 500 });
    }
  }

  if (nativeTracking) {
    const result = await apiFetch(
      clientId,
      authSecret,
      "PUT",
      `/profiles/${clientId}/privacy/natives`,
      NATIVE_TRACKING_IDS.map(id => ({ id }))
    );
    if (!result.success) {
      return NextResponse.json(result, { status: result.status ?? 500 });
    }
  }

  return NextResponse.json({ success: true });
}
