import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Me, Role } from "../../shared/types";
import { hasAny, PANEL_ROLES, parseRoles } from "../../shared/teams";
import { blocked, findCode, normalizeCode, recordFail, tokenMode } from "../access-codes";
import { randomToken, readSession, sha256b64url, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "./session";

export interface AuthEnv {
  DB: D1Database;
  ROBLOX_CLIENT_ID: string;
  ROBLOX_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ROBLOX_REDIRECT_URI?: string;
  /** Optional: Roblox user id that becomes admin on first sign-in while no admin exists. */
  INITIAL_ADMIN_ROBLOX_ID?: string;
  /** Local development only: point OAuth at a mock server. */
  ROBLOX_OAUTH_BASE?: string;
}

const STATE_COOKIE = "flagman_oauth";
const NEXT_COOKIE = "flagman_next";
const base = (env: AuthEnv) => env.ROBLOX_OAUTH_BASE ?? "https://apis.roblox.com";

function origin(c: { req: { url: string; header: (n: string) => string | undefined } }) {
  const url = new URL(c.req.url);
  const host = c.req.header("x-forwarded-host") ?? url.host;
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = isLocal ? "http" : "https";
  return `${proto}://${host}`;
}

export async function getMe(env: AuthEnv, cookie: string | undefined): Promise<Me | null> {
  const claims = await readSession(env.SESSION_SECRET, cookie);
  if (!claims) return null;
  const id = claims.sub;
  // The lookups are independent, so they go out together: one round trip to the database, not several.
  // A token session lasts only while the setting is on and the code it came from is still the current one.
  const token = claims.via === "token";
  const [user, { results }, rows, codeRow, tokensOn] = await Promise.all([
    env.DB.prepare(ME_USER).bind(id).first<MeUser>(),
    env.DB.prepare(ME_ROLES).bind(id).all<{ role: Role }>(),
    env.DB.prepare(ME_TEAMS).bind(id).all<MeTeamRow>(),
    token ? env.DB.prepare("SELECT created_at AS at FROM access_codes WHERE roblox_id = ?").bind(id).first<{ at: number }>() : null,
    token ? tokenMode(env.DB) : true,
  ]);
  if (token && (!codeRow || codeRow.at !== claims.v || !tokensOn)) return null;
  return buildMe(claims, user, results, rows.results);
}

// The three lookups that make up a signed-in user, shared with the registration loader that asks for them in one batch.
export const ME_USER = "SELECT roblox_id AS id, username, display_name AS displayName FROM users WHERE roblox_id = ?";
export const ME_ROLES = "SELECT role FROM user_roles WHERE roblox_id = ?";
export const ME_TEAMS = "SELECT t.id, t.name, m.roles FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.roblox_id = ? ORDER BY lower(t.name)";
export type MeUser = Omit<Me, "roles" | "via" | "teams" | "memberships">;
export type MeTeamRow = { id: string; name: string; roles: string };

export function buildMe(claims: { via: "roblox" | "token" }, user: MeUser | null, roles: { role: Role }[], teamRows: MeTeamRow[]): Me | null {
  if (!user) return null;
  const memberships = teamRows.map((t) => ({ id: t.id, name: t.name, roles: parseRoles(t.roles) }));
  const teams = memberships.filter((t) => hasAny(t.roles, PANEL_ROLES)).map(({ id, name }) => ({ id, name }));
  return { ...user, roles: claims.via === "token" ? [] : roles.map((r) => r.role), via: claims.via, teams, memberships };
}

export const hasRole = (me: Me | null, ...roles: Role[]) =>
  !!me && (me.roles.includes("admin") || roles.some((r) => me.roles.includes(r)));

export const auth = new Hono<{ Bindings: AuthEnv }>();

auth.get("/roblox/login", async (c) => {
  const state = randomToken();
  const verifier = randomToken(48);
  const redirectUri = c.env.ROBLOX_REDIRECT_URI?.trim() || `${origin(c)}/api/auth/roblox/callback`;
  const isLocal = new URL(c.req.url).hostname === "localhost" || new URL(c.req.url).hostname === "127.0.0.1";
  const secure = !isLocal;
  setCookie(c, STATE_COOKIE, `${state}.${verifier}`, { path: "/", httpOnly: true, sameSite: "Lax", secure, maxAge: 600 });
  // Where to land after sign-in: same-site paths only.
  const next = c.req.query("next") ?? "";
  if (/^\/[A-Za-z0-9/_-]*$/.test(next) && !next.startsWith("//")) {
    setCookie(c, NEXT_COOKIE, next, { path: "/", httpOnly: true, sameSite: "Lax", secure, maxAge: 600 });
  }
  const q = new URLSearchParams({
    client_id: c.env.ROBLOX_CLIENT_ID?.trim() ?? "",
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid profile",
    state,
    code_challenge: await sha256b64url(verifier),
    code_challenge_method: "S256",
  });
  return c.redirect(`${base(c.env)}/oauth/v1/authorize?${q}`);
});

auth.get("/roblox/callback", async (c) => {
  const fail = (code: string, detail?: string) => {
    deleteCookie(c, STATE_COOKIE, { path: "/" });
    return c.redirect(`/?auth_error=${code}${detail ? `&detail=${encodeURIComponent(detail)}` : ""}`);
  };
  const { code, state, error, error_description } = c.req.query();
  if (error) return fail("denied", error_description || error);
  const [savedState, verifier] = (getCookie(c, STATE_COOKIE) ?? "").split(".");
  const redirectUri = c.env.ROBLOX_REDIRECT_URI?.trim() || `${origin(c)}/api/auth/roblox/callback`;
  const clientId = c.env.ROBLOX_CLIENT_ID?.trim() ?? "";
  const clientSecret = c.env.ROBLOX_CLIENT_SECRET?.trim() ?? "";
  if (!code || !state || !savedState || state !== savedState || !verifier) return fail("state");

  const tokenRes = await fetch(`${base(c.env)}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => "");
    console.error("Roblox /oauth/v1/token failed:", tokenRes.status, errText);
    let detail = "";
    try {
      const parsed = JSON.parse(errText);
      detail = parsed.error_description || parsed.error || `HTTP ${tokenRes.status}`;
    } catch {
      detail = errText.slice(0, 100) || `HTTP ${tokenRes.status}`;
    }
    return fail("token", detail);
  }
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return fail("token", "No access token in response");

  const infoRes = await fetch(`${base(c.env)}/oauth/v1/userinfo`, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!infoRes.ok) {
    const errText = await infoRes.text().catch(() => "");
    console.error("Roblox /oauth/v1/userinfo failed:", infoRes.status, errText);
    let detail = "";
    try {
      const parsed = JSON.parse(errText);
      detail = parsed.error_description || parsed.error || `HTTP ${infoRes.status}`;
    } catch {
      detail = errText.slice(0, 100) || `HTTP ${infoRes.status}`;
    }
    return fail("profile", detail);
  }
  const info = (await infoRes.json()) as { sub?: string; preferred_username?: string; name?: string; nickname?: string };
  if (!info.sub) return fail("profile");
  const username = info.preferred_username ?? info.name ?? info.sub;
  const display = info.nickname ?? username;

  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO users (roblox_id, username, display_name, created_at, last_login) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(roblox_id) DO UPDATE SET username = ?2, display_name = ?3, last_login = ?4`,
  )
    .bind(info.sub, username, display, now)
    .run();

  // Bootstrap: the configured user becomes admin while no admin exists.
  if (c.env.INITIAL_ADMIN_ROBLOX_ID?.trim() === info.sub) {
    await c.env.DB.prepare(
      "INSERT INTO user_roles (roblox_id, role) SELECT ?1, 'admin' WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE role = 'admin')",
    )
      .bind(info.sub)
      .run();
  }

  const isLocal = new URL(c.req.url).hostname === "localhost" || new URL(c.req.url).hostname === "127.0.0.1";
  const secure = !isLocal;
  deleteCookie(c, STATE_COOKIE, { path: "/" });
  setCookie(c, SESSION_COOKIE, await signSession(c.env.SESSION_SECRET, info.sub), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: SESSION_TTL_MS / 1000,
  });
  const next = getCookie(c, NEXT_COOKIE);
  deleteCookie(c, NEXT_COOKIE, { path: "/" });
  return c.redirect(next && /^\/[A-Za-z0-9/_-]*$/.test(next) && !next.startsWith("//") ? next : "/");
});

/** Sign in with an access code. Needs the setting on; failed guesses are limited per address. */
auth.post("/token", async (c) => {
  if (!(await tokenMode(c.env.DB))) return c.json({ error: "token_off" }, 403);
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "local";
  if (await blocked(c.env.DB, ip)) return c.json({ error: "rate_limited" }, 429);
  const body = (await c.req.json().catch(() => ({}))) as { code?: unknown };
  const code = normalizeCode(body.code);
  const found = code ? await findCode(c.env, code) : null;
  if (!found) {
    await recordFail(c.env.DB, ip);
    return c.json({ error: "invalid_code" }, 401);
  }
  await c.env.DB.prepare("UPDATE access_codes SET last_used = ? WHERE roblox_id = ?").bind(Date.now(), found.id).run();
  const isLocal = new URL(c.req.url).hostname === "localhost" || new URL(c.req.url).hostname === "127.0.0.1";
  const secure = !isLocal;
  setCookie(c, SESSION_COOKIE, await signSession(c.env.SESSION_SECRET, found.id, "token", found.at), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure,
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.json({ ok: true });
});

auth.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
