import { describe, expect, it } from "vitest";
import { encodeQrMatrix, qrToSvgPath, type QrMatrix } from "./qr";

const ALIGN_COORDS: Record<number, readonly number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50]
};

const BLOCK_SPECS: Record<number, readonly { count: number; data: number; ec: number }[]> = {
  1: [{ count: 1, data: 19, ec: 7 }],
  2: [{ count: 1, data: 34, ec: 10 }],
  3: [{ count: 1, data: 55, ec: 15 }],
  4: [{ count: 1, data: 80, ec: 20 }],
  5: [{ count: 1, data: 108, ec: 26 }],
  6: [{ count: 2, data: 68, ec: 18 }],
  7: [{ count: 2, data: 78, ec: 20 }],
  8: [{ count: 2, data: 97, ec: 24 }],
  9: [{ count: 2, data: 116, ec: 30 }],
  10: [
    { count: 2, data: 68, ec: 18 },
    { count: 2, data: 69, ec: 18 }
  ]
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let v = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = v;
    GF_LOG[v] = i;
    v <<= 1;
    if (v & 0x100) v ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function maskBit(mask: number, r: number, c: number): number {
  switch (mask) {
    case 0: return (r + c) % 2 === 0 ? 1 : 0;
    case 1: return r % 2 === 0 ? 1 : 0;
    case 2: return c % 3 === 0 ? 1 : 0;
    case 3: return (r + c) % 3 === 0 ? 1 : 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0 ? 1 : 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0 ? 1 : 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0 ? 1 : 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0 ? 1 : 0;
  }
}

/** Independent ISO/IEC 18004 decoder + Reed-Solomon syndrome verifier for Versions 1–10 (Level L, Byte mode). */
function decodeAndVerifyQr(matrix: QrMatrix): string {
  const { size, modules } = matrix;
  const version = (size - 17) / 4;
  expect(Number.isInteger(version) && version >= 1 && version <= 10).toBe(true);
  const at = (r: number, c: number) => modules[r * size + c];

  // Read both copies of format info and verify they match
  let fmt1 = 0;
  let fmt2 = 0;
  for (let i = 0; i < 15; i++) {
    const b1 =
      i < 6 ? at(8, i) :
      i === 6 ? at(8, 7) :
      i === 7 ? at(8, 8) :
      i === 8 ? at(7, 8) :
      at(14 - i, 8);
    const b2 = i < 7 ? at(size - 1 - i, 8) : at(8, size - 15 + i);
    fmt1 = (fmt1 << 1) | b1;
    fmt2 = (fmt2 << 1) | b2;
  }
  expect(fmt1).toBe(fmt2);

  const unmaskedFmt = fmt1 ^ 0x5412;
  const eccLevel = unmaskedFmt >> 13;
  const mask = (unmaskedFmt >> 10) & 0x7;
  expect(eccLevel).toBe(0b01); // Level L

  // Build function-module mask and verify all alignment patterns (including V7-V10 on timing lines!)
  const isFunc = new Uint8Array(size * size);
  const mark = (r: number, c: number) => {
    if (r >= 0 && c >= 0 && r < size && c < size) isFunc[r * size + c] = 1;
  };
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) mark(top + dy, left + dx);
    }
  }
  const align = ALIGN_COORDS[version];
  const last = size - 7;
  for (const r of align) {
    for (const c of align) {
      if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const expected = Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0;
          expect(at(r + dy, c + dx), `V${version} alignment (${r},${c}) offset (${dy},${dx})`).toBe(expected);
          mark(r + dy, c + dx);
        }
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    expect(at(6, i)).toBe(i % 2 === 0 ? 1 : 0);
    expect(at(i, 6)).toBe(i % 2 === 0 ? 1 : 0);
    mark(6, i);
    mark(i, 6);
  }
  expect(at(size - 8, 8)).toBe(1);
  mark(size - 8, 8);
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      mark(8, i);
      mark(i, 8);
    }
  }
  for (let i = 0; i < 8; i++) {
    mark(8, size - 1 - i);
    if (i < 7) mark(size - 1 - i, 8);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      mark(a, b);
      mark(b, a);
    }
  }

  // Extract raw unmasked bitstream in zigzag order
  const rawBits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const col = right - dx;
        if (isFunc[row * size + col]) continue;
        rawBits.push(at(row, col) ^ maskBit(mask, row, col));
      }
    }
    upward = !upward;
  }

  const groups = BLOCK_SPECS[version];
  const totalCodewords = groups.reduce((sum, g) => sum + g.count * (g.data + g.ec), 0);
  expect(Math.floor(rawBits.length / 8)).toBe(totalCodewords);

  const codewords = new Uint8Array(totalCodewords);
  for (let i = 0; i < totalCodewords; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | rawBits[i * 8 + b];
    codewords[i] = byte;
  }

  // Deinterleave data and EC blocks
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  for (const g of groups) {
    for (let i = 0; i < g.count; i++) {
      blocks.push({ data: new Uint8Array(g.data), ec: new Uint8Array(g.ec) });
    }
  }
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  const maxEc = Math.max(...blocks.map((b) => b.ec.length));
  let pos = 0;
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) {
      if (i < block.data.length) block.data[i] = codewords[pos++];
    }
  }
  for (let i = 0; i < maxEc; i++) {
    for (const block of blocks) {
      if (i < block.ec.length) block.ec[i] = codewords[pos++];
    }
  }

  // Verify Reed-Solomon syndromes are zero for every block
  for (const block of blocks) {
    const poly = new Uint8Array(block.data.length + block.ec.length);
    poly.set(block.data, 0);
    poly.set(block.ec, block.data.length);
    for (let root = 0; root < block.ec.length; root++) {
      const alpha = GF_EXP[root];
      let evalResult = 0;
      for (const coeff of poly) {
        evalResult = gfMul(evalResult, alpha) ^ coeff;
      }
      expect(evalResult, `V${version} RS syndrome root ${root}`).toBe(0);
    }
  }

  // Decode Byte-mode payload from concatenated data blocks
  const dataBytes = new Uint8Array(blocks.reduce((sum, b) => sum + b.data.length, 0));
  let dPos = 0;
  for (const block of blocks) {
    dataBytes.set(block.data, dPos);
    dPos += block.data.length;
  }
  const readBits = (offset: number, len: number) => {
    let val = 0;
    for (let i = 0; i < len; i++) {
      const idx = offset + i;
      val = (val << 1) | ((dataBytes[idx >> 3] >> (7 - (idx & 7))) & 1);
    }
    return val;
  };
  expect(readBits(0, 4)).toBe(0b0100);
  const countBits = version >= 10 ? 16 : 8;
  const byteLen = readBits(4, countBits);
  const payload = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    payload[i] = readBits(4 + countBits + i * 8, 8);
  }
  return new TextDecoder().decode(payload);
}

describe("encodeQrMatrix", () => {
  it("encodes typical AdGuard URLs into a valid QR matrix with ISO 4-module quiet zone", () => {
    const url = "https://dns-conf-ui.vercel.app/adguard/geohide-eu";
    const matrix = encodeQrMatrix(url);
    expect(matrix).not.toBeNull();
    if (!matrix) return;

    expect(matrix.size).toBe(29); // Version 3 for 49 bytes
    expect(decodeAndVerifyQr(matrix)).toBe(url);

    const svg = qrToSvgPath(matrix);
    expect(svg.viewBox).toBe("0 0 37 37");
    expect(svg.path.length).toBeGreaterThan(200);
  });

  it("round-trip decodes cleanly across all versions V1–V10 including V7–V10 timing-line alignment patterns", () => {
    const cases: Array<[number, string]> = [
      [21, "https://a.co/1"],                                    // V1 (14 bytes)
      [25, "https://a.example/adguard/a123"],                    // V2 (30 bytes)
      [29, "https://dns.example/adguard/geohide-eu?ips=1"],      // V3 (44 bytes)
      [33, "https://dns.example/adguard/geohide-eu?exclude=instagram.com,twitch.tv&ips=1"], // V4 (76 bytes)
      [37, "x".repeat(106)],                                     // V5 max
      [41, "x".repeat(134)],                                     // V6 max
      [45, "https://dns.example/adguard/geohide-eu?exclude=instagram.com,twitch.tv,facebook.com,threads.net,tiktok.com,linkedin.com,x.com,spotify.com"], // V7 (137 bytes)
      [49, "y".repeat(192)],                                     // V8 max
      [53, "z".repeat(230)],                                     // V9 max
      [57, "a".repeat(271)]                                      // V10 max
    ];

    for (const [expectedSize, input] of cases) {
      const matrix = encodeQrMatrix(input);
      expect(matrix, `length ${input.length}`).not.toBeNull();
      if (!matrix) continue;
      expect(matrix.size).toBe(expectedSize);
      expect(decodeAndVerifyQr(matrix)).toBe(input);
    }

    expect(encodeQrMatrix("a".repeat(272))).toBeNull();
  });
});
