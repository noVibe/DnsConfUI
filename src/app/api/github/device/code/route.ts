import { NextResponse } from "next/server";
import { getGitHubClientId } from "@/domain/github-app";

export async function POST() {
  const gitHubClientId = getGitHubClientId();

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
