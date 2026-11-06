import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Me, Role, Team } from "../../shared/types";
import { randomToken, readSession, sha256b64url, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "./session";

export interface AuthEnv {
  DB: D1Database;
  ROBLOX_CLIENT_ID: string;
  ROBLOX_CLIENT_SECRET: string;
  SESSION_SECRET: string;
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
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function getMe(env: AuthEnv, cookie: string | undefined): Promise<Me | null> {
  const id = await readSession(env.SESSION_SECRET, cookie);
  if (!id) return null;
  const user = await env.DB.prepare("SELECT roblox_id AS id, username, display_name AS displayName FROM users WHERE roblox_id = ?")
    .bind(id)
    .first<Omit<Me, "roles" | "teams">>();
  if (!user) return null;
  const { results } = await env.DB.prepare("SELECT role FROM user_roles WHERE roblox_id = ?").bind(id).all<{ role: Role }>();
  const teams = await env.DB.prepare(
    "SELECT t.id, t.name FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.roblox_id = ? ORDER BY lower(t.name)",
  )
    .bind(id)
    .all<Team>();
  return { ...user, roles: results.map((r) => r.role), teams: teams.results };
}

export const hasRole = (me: Me | null, ...roles: Role[]) =>
  !!me && (me.roles.includes("admin") || roles.some((r) => me.roles.includes(r)));

export const auth = new Hono<{ Bindings: AuthEnv }>();

auth.get("/roblox/login", async (c) => {
  const state = randomToken();
  const verifier = randomToken(48);
  const secure = new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
  setCookie(c, STATE_COOKIE, `${state}.${verifier}`, { path: "/", httpOnly: true, sameSite: "Lax", secure, maxAge: 600 });
  // Where to land after sign-in: same-site paths only.
  const next = c.req.query("next") ?? "";
  if (/^\/[A-Za-z0-9/_-]*$/.test(next) && !next.startsWith("//")) {
    setCookie(c, NEXT_COOKIE, next, { path: "/", httpOnly: true, sameSite: "Lax", secure, maxAge: 600 });
  }
  const q = new URLSearchParams({
    client_id: c.env.ROBLOX_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${origin(c)}/api/auth/roblox/callback`,
    scope: "openid profile",
    state,
    code_challenge: await sha256b64url(verifier),
    code_challenge_method: "S256",
  });
  return c.redirect(`${base(c.env)}/oauth/v1/authorize?${q}`);
});

auth.get("/roblox/callback", async (c) => {
  const fail = (code: string) => {
    deleteCookie(c, STATE_COOKIE, { path: "/" });
    return c.redirect(`/?auth_error=${code}`);
  };
  const { code, state, error } = c.req.query();
  if (error) return fail("denied");
  const [savedState, verifier] = (getCookie(c, STATE_COOKIE) ?? "").split(".");
  if (!code || !state || !savedState || state !== savedState || !verifier) return fail("state");

  const tokenRes = await fetch(`${base(c.env)}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: c.env.ROBLOX_CLIENT_ID,
      client_secret: c.env.ROBLOX_CLIENT_SECRET,
      redirect_uri: `${origin(c)}/api/auth/roblox/callback`,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return fail("token");
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return fail("token");

  const infoRes = await fetch(`${base(c.env)}/oauth/v1/userinfo`, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!infoRes.ok) return fail("profile");
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

  const secure = new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
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

auth.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
