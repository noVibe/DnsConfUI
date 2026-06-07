import { describe, expect, it, vi } from "vitest";

const mockSodium = {
  ready: Promise.resolve(),
  from_base64: vi.fn((key: string) => new Uint8Array([1, 2, 3])),
  from_string: vi.fn((value: string) => new Uint8Array([4, 5, 6])),
  crypto_box_seal: vi.fn((msg: Uint8Array, key: Uint8Array) => new Uint8Array([7, 8, 9, 10])),
  to_base64: vi.fn((bytes: Uint8Array) => "ZW5jcnlwdGVk"),
  base64_variants: { ORIGINAL: 0 }
};

vi.mock("libsodium-wrappers", () => ({ default: mockSodium }));

const { encryptGitHubSecret } = await import("./crypto");

describe("encryptGitHubSecret", () => {
  it("encrypts the value using libsodium and returns base64", async () => {
    const result = await encryptGitHubSecret("my-secret", "public-key-base64");

    expect(mockSodium.from_base64).toHaveBeenCalledWith("public-key-base64", 0);
    expect(mockSodium.from_string).toHaveBeenCalledWith("my-secret");
    expect(mockSodium.crypto_box_seal).toHaveBeenCalledWith(
      new Uint8Array([4, 5, 6]),
      new Uint8Array([1, 2, 3])
    );
    expect(mockSodium.to_base64).toHaveBeenCalledWith(new Uint8Array([7, 8, 9, 10]), 0);
    expect(result).toBe("ZW5jcnlwdGVk");
  });
});
