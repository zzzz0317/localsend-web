import { decodeBase64, encodeBase64 } from "~/utils/base64";

/**
 * Generate an Ed25519 key pair (publicKey + privateKey).
 * Both keys are exportable.
 */
export async function generateEd25519KeyPair(): Promise<CryptoKeyPair> {
  return (await window.crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
}

/**
 * Generates a fingerprint with the following structure:
 *
 *  HASH_METHOD.HASH.SALT_BASE64.SIGN_METHOD.SIGN
 *
 *  1) HASH_METHOD (e.g. "sha256")
 *  2) HASH (base64-url-no-padding of sha256(publicKeyDER + SALT))
 *  3) SALT_BASE64 (base64-url-no-padding of 8 bytes = timestamp [u64])
 *  4) SIGN_METHOD (e.g. "ed25519")
 *  5) SIGN (base64-url-no-padding of Ed25519 signature over HASH)
 */
export async function generateFingerprint(key: CryptoKeyPair): Promise<string> {
  const publicKeyDER = new Uint8Array(
    await window.crypto.subtle.exportKey("spki", key.publicKey),
  );
  const salt = unixTimestampU64();
  const hashInput = concatBytes(publicKeyDER, salt);
  const digest = await window.crypto.subtle.digest("SHA-256", hashInput);
  const signature = await window.crypto.subtle.sign(
    { name: "Ed25519" },
    key.privateKey,
    digest,
  );

  const hashMethod = "sha256";
  const hashBase64 = encodeBase64(new Uint8Array(digest));
  const saltBase64 = encodeBase64(salt);
  const signMethod = "ed25519";
  const signatureBase64 = encodeBase64(new Uint8Array(signature));

  return [hashMethod, hashBase64, saltBase64, signMethod, signatureBase64].join(
    ".",
  );
}

export async function verifyFingerprint(
  fingerprint: string,
  publicKey: CryptoKey,
): Promise<boolean> {
  const parts = fingerprint.split(".");
  if (parts.length !== 5) {
    return false;
  }

  const [hashMethod, hashB64, saltB64, signMethod, signB64] = parts;

  if (hashMethod !== "sha256") {
    return false;
  }

  if (signMethod !== "ed25519") {
    return false;
  }

  // Decode the salt (8 bytes, big-endian u64, in SECONDS)
  const saltBuffer = decodeBase64(saltB64);
  if (saltBuffer.byteLength !== 8) {
    return false;
  }
  const saltView = new DataView(typedArrayToBuffer(saltBuffer));
  const saltSeconds = Number(saltView.getBigUint64(0, false));

  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (nowInSeconds - saltSeconds > 60 * 60) {
    // Fingerprint is older than 1h, reject
    return false;
  }

  const publicKeyDER = await crypto.subtle.exportKey("spki", publicKey);
  const hashInput = concatBytes(new Uint8Array(publicKeyDER), saltBuffer);

  // Recompute the SHA-256 hash
  const digest = await crypto.subtle.digest("SHA-256", hashInput);
  const recomputedHashB64 = encodeBase64(new Uint8Array(digest));

  if (recomputedHashB64 !== hashB64) {
    return false;
  }

  const signatureBuffer = decodeBase64(signB64);
  return await crypto.subtle.verify(
    { name: "ed25519" },
    publicKey,
    signatureBuffer,
    digest,
  );
}

function unixTimestampU64(): Uint8Array {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const saltBuffer = new ArrayBuffer(8);
  const saltView = new DataView(saltBuffer);
  saltView.setBigUint64(0, BigInt(nowInSeconds), false);
  return new Uint8Array(saltBuffer);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function typedArrayToBuffer(array: Uint8Array): ArrayBuffer {
  return array.buffer.slice(
    array.byteOffset,
    array.byteLength + array.byteOffset,
  );
}
