import { NextResponse } from "next/server";
import { getGitHubClientId, resolveGitHubClientId } from "@/domain/github-app";

/**
 * Starts the device flow.
 *
 * The browser may name the OAuth App to authorize with (`client_id`), which is
 * how someone running this locally uses an app of their own without rebuilding
 * the image; without it the app authorizes with the client ID of this build.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { client_id?: unknown } | null;
  const gitHubClientId = resolveGitHubClientId(body?.client_id, getGitHubClientId());

  if (gitHubClientId === null) {
    return NextResponse.json({ message: "That is not a GitHub client ID." }, { status: 400 });
  }

  if (!gitHubClientId) {
    return NextResponse.json({ message: "GitHub client ID is not configured." }, { status: 500 });
  }

  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: gitHubClientId,
      scope: "repo workflow read:user"
    })
  });

  const data = await response.json();

  return NextResponse.json(data, { status: response.status });
}
