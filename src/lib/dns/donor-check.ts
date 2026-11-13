/**
 * Elapsed milliseconds for each passed check (null when failed) and the exit country chatgpt.com saw.
 * `direct` means the DNS does not proxy chatgpt.com, so the connection exits from the visitor's own network.
 */
export type DonorCheck = { dnsMs: number | null; chatgptMs: number | null; country: string | null; direct: boolean };

const FAILED: DonorCheck = { dnsMs: null, chatgptMs: null, country: null, direct: false };

export function checkDonor(donor: string): Promise<DonorCheck> {
  return fetch("/api/donors/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ donor })
  })
    .then((res) => (res.ok ? (res.json() as Promise<DonorCheck>) : FAILED))
    .catch(() => FAILED);
}

let visitor: Promise<string | null> | null = null;

/** The visitor's own country; 1.1.1.1 is an IP address, so DNS rewrites on the device cannot change it. */
export function visitorCountry(): Promise<string | null> {
  visitor ??= fetch("https://1.1.1.1/cdn-cgi/trace")
    .then((res) => (res.ok ? res.text() : ""))
    .then((text) => /^loc=([A-Z]{2})$/m.exec(text)?.[1] ?? null)
    .catch(() => null);
  return visitor;
}
