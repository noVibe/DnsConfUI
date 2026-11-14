import { NextResponse } from "next/server";
import { z } from "zod";
import { isCheckableDonor, isDnsDonorPreset, type DnsDonor } from "@/domain/dns-donors";

/** Long enough to tell two servers apart, short enough to sit in the monitor's first column. */
const MAX_LABEL_LENGTH = 24;
/** A ceiling at all is what stops a page adding servers in a loop until the process runs out of memory. */
const MAX_ADDED = 20;

const addSchema = z.object({
  url: z
    .string()
    .refine(isCheckableDonor)
    // A preset is already in the list; adding it again would only put the same server in twice.
    .refine((value) => !isDnsDonorPreset(value)),
  label: z.string().trim().min(1).max(MAX_LABEL_LENGTH)
});

/**
 * The DNS proxies added through the monitor, for as long as this container runs.
 *
 * Memory on purpose, and not a file: the app keeps nothing of the user's between runs, and a server added here is
 * a convenience for the session rather than a setting. Restarting the container empties the list, which is what
 * the monitor tells the user when they add one.
 *
 * It lives on the server rather than in the browser because the whole app has to agree on it - the monitor lists
 * these servers, and the hosts panel resolves through them - and because a container is exactly the lifetime the
 * user was promised.
 */
const added: DnsDonor[] = [];

export function GET() {
  return NextResponse.json({ donors: added });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = addSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Send an HTTPS DoH address and a short name." }, { status: 400 });
  }

  const { url, label } = parsed.data;
  // Adding the same address twice is the user asking for what they already have, not an error.
  if (!added.some((donor) => donor.value === url)) {
    if (added.length >= MAX_ADDED) {
      return NextResponse.json({ error: `This container already holds ${MAX_ADDED} added servers.` }, { status: 409 });
    }
    added.push({ label, value: url });
  }

  return NextResponse.json({ donors: added });
}

const removeSchema = z.object({ url: z.string() });

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = removeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Send the address to remove." }, { status: 400 });
  }

  // Removing one that is not there still leaves the caller with the list it asked about, which is what it wanted.
  const index = added.findIndex((donor) => donor.value === parsed.data.url);
  if (index >= 0) added.splice(index, 1);

  return NextResponse.json({ donors: added });
}
