// HMAC and constant-time comparison (Web Crypto only).

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: Uint8Array<ArrayBuffer> | string, message: string): Promise<ArrayBuffer> {
  const raw = typeof key === 'string' ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(message));
}

/** UTC calendar day, `YYYY-MM-DD`. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * visitor_hash = hex(HMAC(daily_salt, ip | user_agent)), where
 * daily_salt = HMAC(secret, UTC day). The salt is never stored, so hashes
 * cannot be reversed or linked across days (docs/V2-CONTRACTS.md §7).
 */
export async function visitorHash(secret: string, ip: string, userAgent: string, now = new Date()): Promise<string> {
  const salt = new Uint8Array(await hmac(secret, utcDay(now)));
  return toHex(await hmac(salt, `${ip}|${userAgent}`));
}

/** Compares two strings in constant time (SHA-256 both, then XOR every byte). */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
