export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function buildKiteChecksum(
  apiKey: string,
  requestToken: string,
  apiSecret: string,
): Promise<string> {
  return sha256Hex(`${apiKey}${requestToken}${apiSecret}`);
}
