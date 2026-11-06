export interface RobloxUser {
  id: string;
  username: string;
  displayName: string;
}

export interface LookupEnv {
  DB: D1Database;
  /** Local development only: point lookups at a mock server. */
  ROBLOX_USERS_BASE?: string;
  ROBLOX_WWW_BASE?: string;
}

export type Lookup = { found: RobloxUser } | { none: true } | { unreachable: true };

const TIMEOUT = 6000;
const exact = (list: { id: number; name: string; displayName?: string }[] | undefined, username: string): RobloxUser | null => {
  const hit = list?.find((u) => u.name.toLowerCase() === username.toLowerCase());
  return hit ? { id: String(hit.id), username: hit.name, displayName: hit.displayName ?? hit.name } : null;
};

/** Exact username lookup. POST, repeated with the CSRF token Roblox hands back on a 403. `null` means the call failed. */
async function byUsernames(base: string, username: string): Promise<Lookup | null> {
  const call = (csrf?: string) =>
    fetch(`${base}/v1/usernames/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  let res = await call().catch(() => null);
  const token = res?.status === 403 ? res.headers.get("x-csrf-token") : null;
  if (token) res = await call(token).catch(() => null);
  if (!res?.ok) return null;
  const data = ((await res.json().catch(() => null)) as { data?: { id: number; name: string; displayName: string }[] } | null)?.data;
  if (!data) return null;
  const hit = exact(data, username);
  return hit ? { found: hit } : { none: true };
}

/** Keyword search, used when the exact lookup fails. */
async function bySearch(base: string, username: string): Promise<Lookup | null> {
  const res = await fetch(`${base}/v1/users/search?keyword=${encodeURIComponent(username)}&limit=10`, { signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
  if (!res?.ok) return null;
  const data = ((await res.json().catch(() => null)) as { data?: { id: number; name: string; displayName: string }[] } | null)?.data;
  if (!data) return null;
  const hit = exact(data, username);
  return hit ? { found: hit } : { none: true };
}

/** The profile page redirects a username to /users/<id>/profile. */
async function byProfile(base: string, username: string): Promise<Lookup | null> {
  const res = await fetch(`${base}/users/profile?username=${encodeURIComponent(username)}`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) }).catch(() => null);
  const m = /\/users\/(\d+)\/profile/.exec(res?.headers.get("location") ?? "");
  return m ? { found: { id: m[1], username, displayName: username } } : null;
}

export async function robloxLookup(env: LookupEnv, username: string): Promise<Lookup> {
  const api = env.ROBLOX_USERS_BASE ?? "https://users.roblox.com";
  const www = env.ROBLOX_WWW_BASE ?? "https://www.roblox.com";
  const tries = [() => byUsernames(api, username), () => bySearch(api, username), () => byProfile(www, username)];
  for (const [i, t] of tries.entries()) {
    const r = await t();
    if (r) return r;
    console.warn(`roblox lookup strategy ${i} failed for a username`);
  }
  return { unreachable: true };
}

/**
 * Find a Roblox user by username and keep our copy of them by Roblox ID, so people can be added
 * before they ever sign in and are matched by ID, not by name, when they do. When Roblox cannot be
 * reached, fall back to a user we already know by that name.
 */
export async function resolveUserId(env: LookupEnv, username: string): Promise<{ user: { id: string; username: string } } | { error: "no_such_roblox_user" | "lookup_failed" }> {
  const r = await robloxLookup(env, username);
  if ("found" in r) {
    const u = r.found;
    await env.DB.prepare(
      `INSERT INTO users (roblox_id, username, display_name, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(roblox_id) DO UPDATE SET username = ?2`,
    )
      .bind(u.id, u.username, u.displayName, Date.now())
      .run();
    return { user: { id: u.id, username: u.username } };
  }
  if ("none" in r) return { error: "no_such_roblox_user" };
  const local = await env.DB.prepare("SELECT roblox_id AS id, username FROM users WHERE lower(username) = lower(?)").bind(username).first<{ id: string; username: string }>();
  return local ? { user: local } : { error: "lookup_failed" };
}
