/**
 * Minimal, zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, Error Correction Level L, Versions 1–10).
 * Keeps the site 100% CSP-clean and offline-capable without third-party QR image services.
 */

type BlockGroup = { count: number; dataCodewords: number; ecCodewords: number };

type VersionSpec = {
  version: number;
  size: number;
  maxBytes: number;
  align: readonly number[];
  blocks: readonly BlockGroup[];
};

const VERSION_SPECS: readonly VersionSpec[] = [
  { version: 1, size: 21, maxBytes: 17, align: [], blocks: [{ count: 1, dataCodewords: 19, ecCodewords: 7 }] },
  { version: 2, size: 25, maxBytes: 32, align: [6, 18], blocks: [{ count: 1, dataCodewords: 34, ecCodewords: 10 }] },
  { version: 3, size: 29, maxBytes: 53, align: [6, 22], blocks: [{ count: 1, dataCodewords: 55, ecCodewords: 15 }] },
  { version: 4, size: 33, maxBytes: 78, align: [6, 26], blocks: [{ count: 1, dataCodewords: 80, ecCodewords: 20 }] },
  { version: 5, size: 37, maxBytes: 106, align: [6, 30], blocks: [{ count: 1, dataCodewords: 108, ecCodewords: 26 }] },
  { version: 6, size: 41, maxBytes: 134, align: [6, 34], blocks: [{ count: 2, dataCodewords: 68, ecCodewords: 18 }] },
  { version: 7, size: 45, maxBytes: 154, align: [6, 22, 38], blocks: [{ count: 2, dataCodewords: 78, ecCodewords: 20 }] },
  { version: 8, size: 49, maxBytes: 192, align: [6, 24, 42], blocks: [{ count: 2, dataCodewords: 97, ecCodewords: 24 }] },
  { version: 9, size: 53, maxBytes: 230, align: [6, 26, 46], blocks: [{ count: 2, dataCodewords: 116, ecCodewords: 30 }] },
  {
    version: 10,
    size: 57,
    maxBytes: 271,
    align: [6, 28, 50],
    blocks: [
      { count: 2, dataCodewords: 68, ecCodewords: 18 },
      { count: 2, dataCodewords: 69, ecCodewords: 18 }
    ]
  }
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEc(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const rem = new Uint8Array(ecCount);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i++) {
        rem[i] ^= gfMul(gen[i + 1], factor);
      }
    }
  }
  return rem;
}

function bchFormatBits(mask: number): number {
  // ECC Level L = 01
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function bchVersionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

function encodeDataCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const totalDataCodewords = spec.blocks.reduce((sum, b) => sum + b.count * b.dataCodewords, 0);
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  // Byte mode indicator (0100) + character count (8 bits for V1-9, 16 bits for V10)
  pushBits(0b0100, 4);
  pushBits(bytes.length, spec.version >= 10 ? 16 : 8);
  for (const byte of bytes) pushBits(byte, 8);

  const capacityBits = totalDataCodewords * 8;
  const terminatorLen = Math.min(4, capacityBits - bits.length);
  pushBits(0, terminatorLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(totalDataCodewords);
  let idx = 0;
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords[idx++] = byte;
  }
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (idx < totalDataCodewords) {
    codewords[idx++] = pads[padIndex++ & 1];
  }
  return codewords;
}

function interleaveCodewords(dataCodewords: Uint8Array, spec: VersionSpec): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  let maxDataLen = 0;
  let maxEcLen = 0;

  for (const group of spec.blocks) {
    for (let i = 0; i < group.count; i++) {
      const slice = dataCodewords.subarray(offset, offset + group.dataCodewords);
      offset += group.dataCodewords;
      dataBlocks.push(slice);
      ecBlocks.push(rsComputeEc(slice, group.ecCodewords));
      if (group.dataCodewords > maxDataLen) maxDataLen = group.dataCodewords;
      if (group.ecCodewords > maxEcLen) maxEcLen = group.ecCodewords;
    }
  }

  const result: number[] = [];
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  for (let i = 0; i < maxEcLen; i++) {
    for (const block of ecBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  return new Uint8Array(result);
}

function maskCondition(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function scorePenalty(modules: Uint8Array, size: number): number {
  let penalty = 0;
  const at = (r: number, c: number) => modules[r * size + c];

  // Rule 1: adjacent runs of same color >= 5
  for (let r = 0; r < size; r++) {
    let runColor = at(r, 0);
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (at(r, c) === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = at(r, c);
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c++) {
    let runColor = at(0, c);
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (at(r, c) === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = at(r, c);
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const color = at(r, c);
      if (color === at(r, c + 1) && color === at(r + 1, c) && color === at(r + 1, c + 1)) {
        penalty += 3;
      }
    }
  }

  // Rule 4: balance of dark modules
  let dark = 0;
  for (let i = 0; i < modules.length; i++) dark += modules[i];
  const percent = (dark * 100) / modules.length;
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return penalty;
}

export type QrMatrix = {
  size: number;
  modules: Uint8Array;
};

export function encodeQrMatrix(text: string): QrMatrix | null {
  const bytes = new TextEncoder().encode(text);
  const spec = VERSION_SPECS.find((candidate) => bytes.length <= candidate.maxBytes);
  if (!spec) return null;

  const size = spec.size;
  const base = new Uint8Array(size * size);
  const isFunc = new Uint8Array(size * size);
  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    base[r * size + c] = dark ? 1 : 0;
    isFunc[r * size + c] = 1;
  };

  // Finder patterns + separators
  const drawFinder = (top: number, left: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const dark =
          dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 &&
          (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setFunc(top + dy, left + dx, dark);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Alignment patterns (drawn before timing patterns so V7-V10 patterns on row/col 6 are not skipped)
  for (const r of spec.align) {
    for (const c of spec.align) {
      if (isFunc[r * size + c]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFunc(r + dy, c + dx, dist !== 1);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Dark module & reserve format info areas
  setFunc(size - 8, 8, true);
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      isFunc[8 * size + i] = 1;
      isFunc[i * size + 8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunc[8 * size + (size - 1 - i)] = 1;
    if (i < 7) isFunc[(size - 1 - i) * size + 8] = 1;
  }

  // Version info for V7+
  if (spec.version >= 7) {
    const vBits = bchVersionBits(spec.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((vBits >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunc(a, b, dark);
      setFunc(b, a, dark);
    }
  }

  // Place interleaved codewords in zigzag columns
  const codewords = interleaveCodewords(encodeDataCodewords(bytes, spec), spec);
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const col = right - dx;
        if (isFunc[row * size + col]) continue;
        let bit = 0;
        if (bitIndex < totalBits) {
          bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
          bitIndex++;
        }
        base[row * size + col] = bit;
      }
    }
    upward = !upward;
  }

  // Choose the mask with the lowest penalty
  let bestModules: Uint8Array | null = null;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = new Uint8Array(base);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunc[r * size + c] && maskCondition(mask, r, c)) {
          candidate[r * size + c] ^= 1;
        }
      }
    }

    const fmt = bchFormatBits(mask);
    for (let i = 0; i < 15; i++) {
      const dark = (fmt >> (14 - i)) & 1;
      // Copy 1: around top-left finder pattern (row 8 left->right, col 8 bottom->top)
      if (i < 6) candidate[8 * size + i] = dark;
      else if (i === 6) candidate[8 * size + 7] = dark;
      else if (i === 7) candidate[8 * size + 8] = dark;
      else if (i === 8) candidate[7 * size + 8] = dark;
      else candidate[(14 - i) * size + 8] = dark;
      // Copy 2: bottom-left vertical (bottom->top) + top-right horizontal (left->right)
      if (i < 7) candidate[(size - 1 - i) * size + 8] = dark;
      else candidate[8 * size + (size - 15 + i)] = dark;
    }

    const score = scorePenalty(candidate, size);
    if (score < bestScore) {
      bestScore = score;
      bestModules = candidate;
    }
  }

  return { size, modules: bestModules! };
}

export function qrToSvgPath(matrix: QrMatrix, quietZone = 4): { viewBox: string; path: string } {
  const total = matrix.size + quietZone * 2;
  const parts: string[] = [];
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (matrix.modules[r * matrix.size + c]) {
        parts.push(`M${c + quietZone},${r + quietZone}h1v1h-1z`);
      }
    }
  }
  return { viewBox: `0 0 ${total} ${total}`, path: parts.join("") };
}
