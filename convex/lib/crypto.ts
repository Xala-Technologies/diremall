/**
 * Encrypts secrets a company gives us (its SMS gateway key) before they are stored, with AES-GCM and a key that only the platform
 * holds (SECRETS_ENC_KEY: 32 random bytes, base64, set with `npx convex env set`). The stored text is "iv.cipher", both base64.
 * The key is never returned to any screen; it is decrypted only inside the job that sends messages.
 */
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(): Promise<CryptoKey> {
  const raw = process.env.SECRETS_ENC_KEY;
  if (!raw) throw new Error("secrets_key_missing");
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error("secrets_key_invalid");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)));
  return `${b64(iv)}.${b64(cipher)}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [iv, cipher] = stored.split(".");
  if (!iv || !cipher) throw new Error("secret_malformed");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(cipher));
  return new TextDecoder().decode(plain);
}
