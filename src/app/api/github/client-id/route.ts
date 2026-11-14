import { NextResponse } from "next/server";
import { z } from "zod";
import { isPlausibleGitHubClientId } from "@/domain/github-app";
import { getStoredGitHubClientId, setStoredGitHubClientId } from "@/lib/github/client-id";
import { isSameOrigin } from "@/lib/http/same-origin";

/** An empty string forgets the stored ID, which puts the app back on the one it ships with. */
const schema = z.object({
  clientId: z.string().refine((value) => value === "" || isPlausibleGitHubClientId(value))
});

export function GET() {
  return NextResponse.json({ clientId: getStoredGitHubClientId() });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Only this app can change this setting." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "That is not a GitHub client ID." }, { status: 400 });
  }

  setStoredGitHubClientId(parsed.data.clientId);
  return NextResponse.json({ clientId: getStoredGitHubClientId() });
}
