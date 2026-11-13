import tls from "node:tls";
import { isPublicAddress } from "./doh";

/** Handshake time with `ip` and whether its certificate validated for the hostname that was asked for. */
export type HostProbe = { ms: number; authorized: boolean };

/**
 * Opens a TLS connection to `ip` with the hostname as SNI and reports how the handshake went, or null when the
 * address is not reachable (or not public) at all.
 *
 * The certificate is not required to validate for the connection to succeed, but `authorized` says whether it did:
 * these proxies pass TLS through to the real origin, so a certificate valid for the hostname proves the address
 * really serves that hostname, while a bare successful connect only proves something listens on port 443.
 */
export function probeHost(ip: string, hostname: string, timeoutMs: number): Promise<HostProbe | null> {
  // A donor can answer with any address, so internal ones are never contacted.
  if (!isPublicAddress(ip)) return Promise.resolve(null);

  return new Promise((resolve) => {
    const started = Date.now();
    const socket = tls.connect({ host: ip, port: 443, servername: hostname, ALPNProtocols: ["http/1.1"], rejectUnauthorized: false });
    // The socket idle timeout does not always fire while connecting, so a hard deadline is used as well.
    const timer = setTimeout(() => finish(null), timeoutMs);
    let settled = false;
    function finish(result: HostProbe | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    }
    socket.setTimeout(timeoutMs, () => finish(null));
    // Nothing is sent or read: the handshake is the whole measurement, so the socket goes away immediately.
    socket.once("secureConnect", () => finish({ ms: Date.now() - started, authorized: socket.authorized }));
    socket.once("error", () => finish(null));
    socket.once("close", () => finish(null));
  });
}
