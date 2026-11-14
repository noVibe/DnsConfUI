import { NextResponse } from "next/server";
import { BUILT_IN_GITHUB_CLIENT_ID, resolveGitHubClientId } from "@/domain/github-app";
import { getStoredGitHubClientId } from "@/lib/github/client-id";

/**
 * Starts the device flow.
 *
 * The browser may name the OAuth App to authorize with (`client_id`), which is
 * how someone running this locally uses an app of their own without rebuilding
 * the image; without it the app authorizes with the client ID of this build.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { client_id?: unknown } | null;
  // The app this container is set to, which is the one it ships with until someone names another in the UI.
  const gitHubClientId = resolveGitHubClientId(body?.client_id, getStoredGitHubClientId() || BUILT_IN_GITHUB_CLIENT_ID);

  if (gitHubClientId === null) {
    return NextResponse.json({ message: "That is not a GitHub client ID." }, { status: 400 });
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
