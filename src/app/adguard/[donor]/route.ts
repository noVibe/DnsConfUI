import { NextResponse } from "next/server";
import { parseAdGuardQueryParams } from "@/domain/adguard-sources";
import { getDnsDonorBySlug } from "@/domain/dns-donors";
import { getAdGuardStore } from "@/lib/adguard/store";

export const dynamic = "force-dynamic";

const SAFE_HOST_PATTERN = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

function resolveOrigin(request: Request): string {
  const configured = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL)?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // Fall through to validated request headers.
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() || "https";
  if (
    forwardedHost &&
    SAFE_HOST_PATTERN.test(forwardedHost) &&
    (forwardedProto === "http" || forwardedProto === "https")
  ) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return "https://dns-conf-ui.vercel.app";
  }
}

function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((part) => part.trim().replace(/^W\//, ""))
    .some((candidate) => candidate === "*" || candidate === etag);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ donor: string }> }
) {
  const { donor: rawDonor } = await context.params;
  const donor = getDnsDonorBySlug(rawDonor);
  if (!donor) {
    const safeDonor = rawDonor.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
    return new NextResponse(safeDonor ? `Unknown DNS donor "${safeDonor}".` : "Unknown DNS donor.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  const url = new URL(request.url);
  const parsedQuery = parseAdGuardQueryParams(url.searchParams);
  if (!parsedQuery.ok) {
    return new NextResponse(parsedQuery.error, {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  const result = await getAdGuardStore().compileForDonor(donor.slug, parsedQuery.options, resolveOrigin(request));
  if (!result.ok) {
    return new NextResponse(result.error, {
      status: result.status,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "300",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  const { compiled, updatedAt } = result;
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=1800, stale-while-revalidate=3600",
    ETag: compiled.etag,
    "Last-Modified": new Date(updatedAt).toUTCString(),
    "X-Content-Type-Options": "nosniff",
    "X-Rules-Count": String(compiled.rulesCount),
    "X-Domains-Count": String(compiled.compressedDomainsCount)
  };

  if (etagMatches(request.headers.get("if-none-match"), compiled.etag)) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(compiled.text, { status: 200, headers });
}
