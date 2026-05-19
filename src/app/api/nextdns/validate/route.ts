import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  clientId: z.string().min(1),
  authSecret: z.string().min(1)
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ valid: false, error: "Invalid request body." }, { status: 400 });
  }

  const { clientId, authSecret } = parsed.data;

  try {
    const res = await fetch(`https://api.nextdns.io/profiles/${clientId}`, {
      headers: { "X-Api-Key": authSecret }
    });

    if (res.ok) {
      return NextResponse.json({ valid: true });
    }

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({
        valid: false,
        error: "Invalid NextDNS credentials. Try generating a new API key at my.nextdns.io/account."
      });
    }

    if (res.status === 404) {
      return NextResponse.json({
        valid: false,
        error: "Profile not found. Check your CLIENT_ID."
      });
    }

    return NextResponse.json({
      valid: false,
      error: `NextDNS API returned ${res.status}.`
    });
  } catch {
    return NextResponse.json({
      valid: false,
      error: "Cannot reach NextDNS API. Check your network connection."
    });
  }
}
