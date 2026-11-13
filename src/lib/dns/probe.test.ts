import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeHost } from "./probe";

const tlsMocks = vi.hoisted(() => ({ connect: vi.fn() }));

// Only the socket is mocked; the address filter probeHost applies first stays real.
vi.mock("node:tls", async (importOriginal) => {
  const mocked = { ...(await importOriginal<typeof import("node:tls")>()), connect: tlsMocks.connect };
  return { ...mocked, default: mocked };
});

class FakeSocket extends EventEmitter {
  authorized = false;
  destroyed = false;
  idleTimeout: { ms: number; onTimeout: () => void } | null = null;

  destroy() {
    this.destroyed = true;
  }

  setTimeout(ms: number, onTimeout: () => void) {
    this.idleTimeout = { ms, onTimeout };
  }
}

// probeHost registers its listeners synchronously, so the returned socket can be driven right away.
function probe(ip = "203.0.113.9", hostname = "claude.ai", timeoutMs = 5000) {
  const socket = new FakeSocket();
  tlsMocks.connect.mockReturnValueOnce(socket);
  return { socket, result: probeHost(ip, hostname, timeoutMs) };
}

describe("probeHost", () => {
  beforeEach(() => {
    tlsMocks.connect.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses non-public addresses before opening a socket", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.1", "::1", "::ffff:127.0.0.1", "not-an-ip"]) {
      await expect(probeHost(ip, "claude.ai", 5000), ip).resolves.toBeNull();
    }
    expect(tlsMocks.connect).not.toHaveBeenCalled();
  });

  it("connects to port 443 with the hostname as SNI and does not reject an invalid certificate", () => {
    const { socket } = probe("193.233.112.67", "claude.ai");
    socket.emit("error", new Error("stop"));

    expect(tlsMocks.connect).toHaveBeenCalledWith({
      host: "193.233.112.67",
      port: 443,
      servername: "claude.ai",
      ALPNProtocols: ["http/1.1"],
      rejectUnauthorized: false
    });
  });

  it("reports the handshake time and a certificate that validated, then drops the socket", async () => {
    const { socket, result } = probe("193.233.112.67");
    socket.authorized = true;
    vi.advanceTimersByTime(40);
    socket.emit("secureConnect");

    expect(await result).toEqual({ ms: 40, authorized: true });
    expect(socket.destroyed).toBe(true);
  });

  it("reports a handshake whose certificate did not validate for the hostname", async () => {
    const { socket, result } = probe();
    socket.authorized = false;
    socket.emit("secureConnect");

    expect(await result).toEqual({ ms: 0, authorized: false });
  });

  it("returns null when the connection fails", async () => {
    const { socket, result } = probe();
    socket.emit("error", new Error("ECONNREFUSED"));

    expect(await result).toBeNull();
    expect(socket.destroyed).toBe(true);
  });

  it("returns null when the socket closes without a handshake", async () => {
    const { socket, result } = probe();
    socket.emit("close");

    expect(await result).toBeNull();
  });

  it("gives up on the hard deadline and ignores a late handshake", async () => {
    const { socket, result } = probe("193.233.112.68", "claude.ai", 3000);
    vi.advanceTimersByTime(3000);
    socket.authorized = true;
    socket.emit("secureConnect");

    expect(await result).toBeNull();
    expect(socket.destroyed).toBe(true);
  });

  it("gives up when the socket itself times out", async () => {
    const { socket, result } = probe("159.194.200.33", "claude.ai", 2500);
    expect(socket.idleTimeout?.ms).toBe(2500);
    socket.idleTimeout?.onTimeout();

    expect(await result).toBeNull();
    expect(socket.destroyed).toBe(true);
  });
});
