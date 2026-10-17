// RFC 6238 time-based one-time passwords (HMAC-SHA1, 6 digits, 30 s steps), the format authenticator apps use.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("invalid_base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export const newSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

export async function hotp(secret: string, counter: number, digits = 6): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base32Decode(secret) as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setUint32(0, Math.floor(counter / 2 ** 32));
  new DataView(msg.buffer).setUint32(4, counter >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[h.length - 1]! & 15;
  const bin = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const STEP = 30;

/** The time step the code matches (allowing one step of clock drift either way), or null. */
export async function verifyTotp(secret: string, code: string, now = Date.now()): Promise<number | null> {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const c = Math.floor(now / 1000 / STEP);
  let hit: number | null = null;
  for (const d of [-1, 0, 1]) if ((await hotp(secret, c + d)) === clean && hit === null) hit = c + d;
  return hit;
}

export const otpauthUri = (secret: string, account: string, issuer = "Rentals") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

export async function sha256Hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Ten-character recovery codes, grouped for reading: XXXXX-XXXXX. */
export function newRecoveryCode(): string {
  const a = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = [...r].map((x) => a[x % a.length]).join("");
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
