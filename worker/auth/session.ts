// Session cookie: base64url(JSON payload) "." base64url(HMAC-SHA256). Key: SESSION_SECRET.
const enc = new TextEncoder();

export const SESSION_COOKIE = "flagman_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

const b64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const key = (secret: string, usage: KeyUsage[]) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);

export async function signSession(secret: string, sub: string): Promise<string> {
  const payload = b64(enc.encode(JSON.stringify({ sub, exp: Date.now() + SESSION_TTL_MS })));
  const sig = await crypto.subtle.sign("HMAC", await key(secret, ["sign"]), enc.encode(payload));
  return `${payload}.${b64(sig)}`;
}

/** Returns the Roblox user id, or null if the cookie is missing, forged or expired. */
export async function readSession(secret: string, cookie: string | undefined): Promise<string | null> {
  if (!cookie) return null;
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret, ["verify"]), unb64(sig), enc.encode(payload));
    if (!ok) return null;
    const { sub, exp } = JSON.parse(new TextDecoder().decode(unb64(payload)));
    return typeof sub === "string" && Date.now() < exp ? sub : null;
  } catch {
    return null;
  }
}

export async function sha256b64url(s: string) {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

export const randomToken = (bytes = 32) => b64(crypto.getRandomValues(new Uint8Array(bytes)));
