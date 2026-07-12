export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Strip BOM / zero-width chars that break Kite checksums when pasted. */
export function sanitizeKiteCredential(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

export function buildKiteChecksum(
  apiKey: string,
  requestToken: string,
  apiSecret: string,
): Promise<string> {
  return sha256Hex(
    `${sanitizeKiteCredential(apiKey)}${sanitizeKiteCredential(requestToken)}${sanitizeKiteCredential(apiSecret)}`,
  );
}
