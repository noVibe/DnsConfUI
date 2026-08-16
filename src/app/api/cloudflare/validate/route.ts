import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  clientId: z.string().min(1),
  authSecret: z.string().min(1)
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ valid: false, error: "Invalid request body." }, { status: 400 });
  }

  const { clientId, authSecret } = parsed.data;

  try {
    const verifyRes = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { Authorization: `Bearer ${authSecret}` }
    });

    if (!verifyRes.ok) {
      return NextResponse.json({
        valid: false,
        error: "Invalid Cloudflare API token. Create a new token at dash.cloudflare.com/profile/api-tokens."
      });
    }

    const verifyData = await verifyRes.json() as { success?: boolean };

    if (!verifyData.success) {
      return NextResponse.json({
        valid: false,
        error: "Invalid Cloudflare API token. Create a new token at dash.cloudflare.com/profile/api-tokens."
      });
    }

    const accountRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${clientId}`, {
      headers: { Authorization: `Bearer ${authSecret}` }
    });

    if (!accountRes.ok) {
      return NextResponse.json({
        valid: false,
        error: "CLIENT_ID (Account ID) does not match the token. Check your Account ID at dash.cloudflare.com."
      });
    }

    return NextResponse.json({ valid: true });
  } catch {
    return NextResponse.json({
      valid: false,
      error: "Cannot reach Cloudflare API. Check your network connection."
    });
  }
}
