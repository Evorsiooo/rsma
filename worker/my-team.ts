import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { Me, MyTeam, TeamKind } from "../shared/types";
import { cleanRoles, hasAny, MANAGER_ROLES, parseRoles, type TeamRole } from "../shared/teams";
import { getMe } from "./auth";
import { SESSION_COOKIE } from "./auth/session";
import { cleanUsername, resolveUser, type AdminEnv } from "./admin";

type C = Context<{ Bindings: AdminEnv; Variables: { me: Me } }>;

/** Team management for the people in a team. Admins edit any team through /api/admin. */
export const myTeams = new Hono<{ Bindings: AdminEnv; Variables: { me: Me } }>();

myTeams.use("*", async (c, next) => {
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (!me) return c.json({ error: "unauthorized" }, 401);
  c.set("me", me);
  await next();
});

async function load(c: C, teamId: string): Promise<MyTeam | null> {
  const t = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.kind, t.car, f.name AS factoryName FROM teams t LEFT JOIN teams f ON f.id = t.factory_id WHERE t.id = ?`,
  )
    .bind(teamId)
    .first<{ id: string; name: string; kind: TeamKind; car: string | null; factoryName: string | null }>();
  if (!t) return null;
  const { results } = await c.env.DB.prepare(
    "SELECT u.roblox_id AS id, u.username, m.roles FROM team_members m JOIN users u ON u.roblox_id = m.roblox_id WHERE m.team_id = ? ORDER BY lower(u.username)",
  )
    .bind(teamId)
    .all<{ id: string; username: string; roles: string }>();
  const members = results.map((m) => ({ id: m.id, username: m.username, roles: parseRoles(m.roles) }));
  const mine = members.find((m) => m.id === c.get("me").id);
  if (!mine) return null;
  return { ...t, roles: mine.roles, members };
}

myTeams.get("/", async (c) => c.json(c.get("me").memberships));

myTeams.get("/:teamId", async (c) => {
  const team = await load(c, c.req.param("teamId"));
  return team ? c.json(team) : c.json({ error: "not_found" }, 404);
});

/** Loads the team and checks the caller may manage it. */
async function manager(c: C): Promise<MyTeam | Response> {
  const team = await load(c, c.req.param("teamId") ?? "");
  if (!team) return c.json({ error: "not_found" }, 404);
  if (!hasAny(team.roles, MANAGER_ROLES)) return c.json({ error: "forbidden" }, 403);
  return team;
}

myTeams.post("/:teamId/members", async (c) => {
  const team = await manager(c);
  if (team instanceof Response) return team;
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; roles?: unknown };
  const username = cleanUsername(body.username);
  if (!username) return c.json({ error: "invalid_username" }, 400);
  const roles = body.roles === undefined ? (["driver"] as TeamRole[]) : cleanRoles(body.roles);
  if (!roles || roles.includes("principal")) return c.json({ error: "invalid_roles" }, 400);
  const user = await resolveUser(c.env, username);
  if (!user) return c.json({ error: "no_such_roblox_user" }, 404);
  if (team.members.some((m) => m.id === user.id)) return c.json({ error: "already_member" }, 409);
  await c.env.DB.prepare("INSERT INTO team_members (team_id, roblox_id, roles) VALUES (?, ?, ?)").bind(team.id, user.id, roles.join(",")).run();
  return c.json(user);
});

myTeams.put("/:teamId/members/:uid/roles", async (c) => {
  const team = await manager(c);
  if (team instanceof Response) return team;
  const target = team.members.find((m) => m.id === c.req.param("uid"));
  if (!target) return c.json({ error: "not_found" }, 404);
  // The Team Principal role is fixed to the team owner.
  if (target.roles.includes("principal")) return c.json({ error: "principal_fixed" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { roles?: unknown };
  const roles = cleanRoles(body.roles);
  if (!roles || roles.includes("principal")) return c.json({ error: "invalid_roles" }, 400);
  await c.env.DB.prepare("UPDATE team_members SET roles = ? WHERE team_id = ? AND roblox_id = ?").bind(roles.join(","), team.id, target.id).run();
  return c.json({ ok: true });
});

myTeams.delete("/:teamId/members/:uid", async (c) => {
  const team = await manager(c);
  if (team instanceof Response) return team;
  const target = team.members.find((m) => m.id === c.req.param("uid"));
  if (!target) return c.json({ error: "not_found" }, 404);
  if (target.roles.includes("principal")) return c.json({ error: "principal_fixed" }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM team_members WHERE team_id = ? AND roblox_id = ?").bind(team.id, target.id),
    c.env.DB.prepare("DELETE FROM registrations WHERE team_id = ? AND roblox_id = ? AND kind != 'spectator'").bind(team.id, target.id),
  ]);
  return c.json({ ok: true });
});

myTeams.post("/:teamId/leave", async (c) => {
  const team = await load(c, c.req.param("teamId"));
  if (!team) return c.json({ error: "not_found" }, 404);
  if (team.roles.includes("principal")) return c.json({ error: "principal_fixed" }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM team_members WHERE team_id = ? AND roblox_id = ?").bind(team.id, c.get("me").id),
    c.env.DB.prepare("DELETE FROM registrations WHERE team_id = ? AND roblox_id = ? AND kind != 'spectator'").bind(team.id, c.get("me").id),
  ]);
  return c.json({ ok: true });
});
