import { NextResponse } from "next/server";
import { getAdGuardStore } from "@/lib/adguard/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const donors = await getAdGuardStore().getStatusSummaries();
  return NextResponse.json({ donors }, {
    headers: { "Cache-Control": "no-store" }
  });
}
