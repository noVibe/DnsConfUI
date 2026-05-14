import sodium from "libsodium-wrappers";

export type GitHubPublicKey = {
  key: string;
  key_id: string;
};

export async function encryptGitHubSecret(value: string, publicKey: string): Promise<string> {
  await sodium.ready;

  const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const valueBytes = sodium.from_string(value);
  const encryptedBytes = sodium.crypto_box_seal(valueBytes, keyBytes);

  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}
