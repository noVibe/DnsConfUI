import { NextResponse } from "next/server";
import { z } from "zod";
import { getGitHubClientId } from "@/domain/github-app";

const tokenRequestSchema = z.object({
  device_code: z.string().min(1)
});

export async function POST(request: Request) {
  const gitHubClientId = getGitHubClientId();

  if (!gitHubClientId) {
    return NextResponse.json({ message: "GitHub client ID is not configured." }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const parsed = tokenRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ message: "Device code is required." }, { status: 400 });
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
