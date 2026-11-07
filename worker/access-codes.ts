import { hmacB64 } from "./auth/session";

export interface CodeEnv {
  DB: D1Database;
  SESSION_SECRET: string;
}

// 31 characters without lookalikes (no 0/o, 1/l/i): 9 of them is about 44 bits.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** "xxx-xxx-xxx", or null when the text is not a well-formed code. */
export const normalizeCode = (text: unknown): string | null => {
  if (typeof text !== "string") return null;
  const t = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return t.length === 9 && [...t].every((ch) => ALPHABET.includes(ch)) ? t : null;
};
export const showCode = (c: string) => `${c.slice(0, 3)}-${c.slice(3, 6)}-${c.slice(6)}`;

function randomCode(): string {
  const out: string[] = [];
  while (out.length < 9) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    for (const x of b) if (x < 248 && out.length < 9) out.push(ALPHABET[x % 31]); // 248 = 31 * 8, no modulo bias
  }
  return out.join("");
}

export async function tokenMode(db: D1Database): Promise<boolean> {
  return (await db.prepare("SELECT value FROM settings WHERE key = 'token_mode'").first<{ value: string }>())?.value === "1";
}

export const setTokenMode = (db: D1Database, on: boolean) =>
  db.prepare("INSERT INTO settings (key, value) VALUES ('token_mode', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(on ? "1" : "0").run();

/** Replaces the user's code with a new one and returns it. Only the keyed hash is stored. */
export async function issueCode(env: CodeEnv, userId: string, by: string): Promise<{ code: string; at: number }> {
  const at = Date.now();
  for (;;) {
    const code = randomCode();
    const hash = await hmacB64(env.SESSION_SECRET, code);
    try {
      await env.DB.prepare(
        `INSERT INTO access_codes (roblox_id, code_hash, created_at, created_by) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(roblox_id) DO UPDATE SET code_hash = ?2, created_at = ?3, created_by = ?4, last_used = NULL`,
      )
        .bind(userId, hash, at, by)
        .run();
      return { code: showCode(code), at };
    } catch {
      // Hash collision with another user's code: draw again.
    }
  }
}

export const revokeCode = (db: D1Database, userId: string) => db.prepare("DELETE FROM access_codes WHERE roblox_id = ?").bind(userId).run();

/** The user a code belongs to, with the time it was issued. */
export async function findCode(env: CodeEnv, code: string): Promise<{ id: string; at: number } | null> {
  const hash = await hmacB64(env.SESSION_SECRET, code);
  const row = await env.DB.prepare("SELECT roblox_id AS id, created_at AS at FROM access_codes WHERE code_hash = ?").bind(hash).first<{ id: string; at: number }>();
  return row ?? null;
}

const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;

const failKey = (ip: string) => `fail:${ip}`;

/** Counts one use of `key` in the current window; false once over `max`. */
export async function hit(db: D1Database, key: string, max: number): Promise<boolean> {
  const win = Math.floor(Date.now() / WINDOW_MS);
  const row = await db
    .prepare("INSERT INTO login_attempts (key, window, n) VALUES (?1, ?2, 1) ON CONFLICT(key, window) DO UPDATE SET n = n + 1 RETURNING n")
    .bind(key, win)
    .first<{ n: number }>();
  return (row?.n ?? 1) <= max;
}

/** True once this address has used up its failed guesses for the window. */
export async function blocked(db: D1Database, ip: string): Promise<boolean> {
  const win = Math.floor(Date.now() / WINDOW_MS);
  const row = await db.prepare("SELECT n FROM login_attempts WHERE key = ? AND window = ?").bind(failKey(ip), win).first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_FAILS;
}

export async function recordFail(db: D1Database, ip: string): Promise<void> {
  const win = Math.floor(Date.now() / WINDOW_MS);
  await db.prepare("INSERT INTO login_attempts (key, window, n) VALUES (?1, ?2, 1) ON CONFLICT(key, window) DO UPDATE SET n = n + 1").bind(failKey(ip), win).run();
  if (Math.random() < 0.02) await db.prepare("DELETE FROM login_attempts WHERE window < ?").bind(win - 1).run();
}

/** May `issuer` hand out a code for this user? Admins: anyone. Others: only people with no global role and no other team, so a code never opens more than the issuer already controls. */
export async function canIssueFor(
  db: D1Database,
  target: string,
  scope: { teamId: string } | { registered: string },
): Promise<boolean> {
  if (await db.prepare("SELECT 1 FROM user_roles WHERE roblox_id = ?").bind(target).first()) return false;
  const teams = (await db.prepare("SELECT team_id FROM team_members WHERE roblox_id = ?").bind(target).all<{ team_id: string }>()).results;
  if ("teamId" in scope) return teams.length === 1 && teams[0].team_id === scope.teamId;
  if (teams.length) return false;
  return !!(await db.prepare("SELECT 1 FROM registrations WHERE session_id = ? AND roblox_id = ?").bind(scope.registered, target).first());
}
