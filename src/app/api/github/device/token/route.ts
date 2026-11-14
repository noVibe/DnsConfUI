import { NextResponse } from "next/server";
import { z } from "zod";
import { BUILT_IN_GITHUB_CLIENT_ID, resolveGitHubClientId } from "@/domain/github-app";
import { getStoredGitHubClientId } from "@/lib/github/client-id";

const tokenRequestSchema = z.object({
  device_code: z.string().min(1),
  /** The app the device code was issued for, when the browser asked for one of its own. */
  client_id: z.string().optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = tokenRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: "Device code is required." }, { status: 400 });
  }

  // The same app that issued the device code has to redeem it, so this must be
  // resolved exactly as the code request resolved it.
  const gitHubClientId = resolveGitHubClientId(parsed.data.client_id, getStoredGitHubClientId() || BUILT_IN_GITHUB_CLIENT_ID);

  if (gitHubClientId === null) {
    return NextResponse.json({ message: "That is not a GitHub client ID." }, { status: 400 });
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: gitHubClientId,
      device_code: parsed.data.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    })
  });

  const data = await response.json();

  return NextResponse.json(data, { status: response.status });
}
