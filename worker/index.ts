import { tokenMode } from "./access-codes";
import { Hono, type Context } from "hono";
import type { Me } from "../shared/types";
import { auth, getMe, hasRole, type AuthEnv } from "./auth";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE } from "./auth/session";
import { admin } from "./admin";
import { myTeams } from "./my-team";
import { registration } from "./registration";
import { syncRegistered, teamWithCar } from "./stage";
import { loadRaces, loadSession } from "./sessions";
import { notifyStewardMessage } from "./discord";

export { RaceDO } from "./race-do";

interface Env extends AuthEnv {
  RACE: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();
// Live data: never let a browser or the edge reuse an API response.
app.use("/api/*", async (c, next) => {
  await next();
  // Responses from the Durable Object and redirects have immutable headers, so copy them; leave WebSocket upgrades alone.
  if (c.res.status === 101) return;
  const res = new Response(c.res.body, c.res);
  res.headers.set("Cache-Control", "no-store");
  c.res = res;
});

app.route("/api/auth", auth);
app.route("/api/admin", admin);
app.route("/api/my-teams", myTeams);
app.route("/api/registration", registration);

app.get("/api/config", async (c) => c.json({ tokenMode: await tokenMode(c.env.DB) }));

app.get("/api/me", async (c) => c.json(await getMe(c.env, getCookie(c, SESSION_COOKIE))));

app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true });
});

// Public: races that are active and not expired.
app.get("/api/races", async (c) => c.json(await loadRaces(c.env.DB, "WHERE status = 'active' AND expires_at > ?1 ORDER BY expires_at ASC")));

// Public: archived or expired races, newest first. Their results stay readable.
app.get("/api/races/past", async (c) =>
  c.json(await loadRaces(c.env.DB, "WHERE status = 'archived' OR expires_at <= ?1 ORDER BY expires_at DESC LIMIT 50")),
);

app.get("/api/races/:id", async (c) => {
  const [race] = await loadRaces(c.env.DB, "WHERE id = ?2", c.req.param("id"));
  return race ? c.json(race) : c.json({ error: "not_found" }, 404);
});

app.get("/api/sessions/:id", async (c) => {
  const info = await loadSession(c.env.DB, c.req.param("id"));
  return info ? c.json(info) : c.json({ error: "not_found" }, 404);
});

const doOf = (env: Env, sessionId: string) => env.RACE.get(env.RACE.idFromName(sessionId));

// Registrations made before a session's queue existed (or before this worker version) are brought in once per isolate.
const synced = new Set<string>();
async function ensureRegistered(env: Env, id: string) {
  if (synced.has(id)) return;
  synced.add(id);
  await syncRegistered(env, id).catch(() => synced.delete(id));
}

app.get("/api/sessions/:id/state", async (c) => {
  const id = c.req.param("id");
  const info = await loadSession(c.env.DB, id);
  if (!info) return c.json({ error: "not_found" }, 404);
  await ensureRegistered(c.env, id);
  const headers = new Headers();
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (me) {
    if (await isRaceSteward(c.env, me, info.race.id)) headers.set("x-staff", "1");
    headers.set("x-user", me.username);
    headers.set("x-teams", me.teams.map((t) => t.id).join(","));
  }
  return doOf(c.env, id).fetch("http://do/state", new Request("http://do/state", { headers }));
});

async function isRaceSteward(env: Env, me: Me | null, raceId: string) {
  if (!me) return false;
  if (hasRole(me, "steward")) return true;
  if (me.via === "token") return false;
  return !!(await env.DB.prepare("SELECT 1 FROM race_stewards WHERE race_id = ? AND roblox_id = ?").bind(raceId, me.id).first());
}

// Public live feed, or the staff feed (full state with audit log) for stewards.
app.get("/api/sessions/:id/ws", async (c) => {
  const id = c.req.param("id");
  const info = await loadSession(c.env.DB, id);
  if (!info) return c.json({ error: "not_found" }, 404);
  await ensureRegistered(c.env, id);
  const headers = new Headers(c.req.raw.headers);
  for (const h of ["x-staff", "x-user", "x-teams", "x-radio"]) headers.delete(h);
  if (c.req.query("staff") === "1" || c.req.query("auth") === "1" || c.req.query("radio") === "1") {
    const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
    if (!me) return c.json({ error: "unauthorized" }, 401);
    if (c.req.query("staff") === "1") {
      if (!(await isRaceSteward(c.env, me, info.race.id))) return c.json({ error: "forbidden" }, 403);
      headers.set("x-staff", "1");
    } else {
      // Signed-in feed: own radio, plus the channels of the teams this user may open.
      headers.set("x-user", me.username);
      headers.set("x-teams", me.teams.map((t) => t.id).join(","));
      if (c.req.query("radio") === "1") {
        headers.set("x-radio", me.username);
      }
    }
  }
  return doOf(c.env, id).fetch("http://do/ws", new Request(c.req.raw, { headers }));
});

// Steward commands. The role check happens here; the Durable Object validates and applies.
const RACE_TIMING_CMDS = ["go", "finish", "assign", "discard", "lap", "setTime", "unattribute", "reattribute", "dnf", "undnf", "setMode", "penalty", "teamGo", "teamFinish", "teamMove", "queueAgain"];

app.post("/api/sessions/:id/cmd", async (c) => {
  const id = c.req.param("id");
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (!me) return c.json({ error: "unauthorized" }, 401);
  const info = await loadSession(c.env.DB, id);
  if (!info) return c.json({ error: "not_found" }, 404);
  if (!(await isRaceSteward(c.env, me, info.race.id))) return c.json({ error: "forbidden" }, 403);
  if (info.race.ended) return c.json({ error: "race_ended" }, 409);
  const cmd = await c.req.json().catch(() => null);
  if (!cmd || typeof cmd.type !== "string") return c.json({ error: "invalid" }, 400);
  // Team commands only come through the team routes; self-timed sessions have no steward Go or Stop.
  if (["teamGo", "teamFinish", "teamMove", "teamNote", "teamNoteDel", "syncReg", "ask", "answer", "driverRadio"].includes(cmd.type)) return c.json({ error: "invalid" }, 400);
  if (info.session.selfTimed && (cmd.type === "go" || cmd.type === "finish" || cmd.type === "queueAgain")) return c.json({ error: "self_timed" }, 409);
  // Races are run differently for now: no live timing.
  if (info.session.type === "race" && RACE_TIMING_CMDS.includes(cmd.type)) return c.json({ error: "race_timing_off" }, 409);
  if (cmd.type === "add" && !info.session.staging) return c.json({ error: "staging_off" }, 409);
  if (cmd.type === "add" && cmd.team != null) {
    // Take the team name from the database, never from the client.
    const team = typeof cmd.team.id === "string" ? await teamWithCar(c.env.DB, cmd.team.id) : null;
    if (!team) return c.json({ error: "invalid" }, 400);
    cmd.team = team;
  }
  if (cmd.type === "radioTeams") {
    const ids: unknown[] = Array.isArray(cmd.teams) ? cmd.teams.map((t: { id?: unknown }) => t?.id) : [];
    const known = (await c.env.DB.prepare("SELECT id, name FROM teams ORDER BY lower(name)").all<{ id: string; name: string }>()).results;
    cmd.teams = known.filter((t) => ids.includes(t.id));
  }
  const doRes = await doOf(c.env, id).fetch("http://do/cmd", {
    method: "POST",
    body: JSON.stringify({ cmd, actor: me.username }),
  });
  if (doRes.ok && (cmd.type === "radio" || cmd.type === "radioTeams") && typeof cmd.text === "string" && cmd.text.trim()) {
    const p = notifyStewardMessage(c.env.DB, cmd.text.trim());
    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(p);
    } else {
      await p;
    }
  }
  return doRes;
});

// Team names for the staging dropdown.
app.get("/api/teams", async (c) => {
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (!me) return c.json({ error: "unauthorized" }, 401);
  const { results } = await c.env.DB.prepare("SELECT id, name FROM teams ORDER BY lower(name)").all<{ id: string; name: string }>();
  return c.json(results);
});

// Team radio: members of the team send to their own channel. Stewards see it in the staff feed.
app.post("/api/sessions/:id/team/:teamId/radio", async (c) => {
  const id = c.req.param("id");
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (!me) return c.json({ error: "unauthorized" }, 401);
  const team = me.teams.find((t) => t.id === c.req.param("teamId"));
  if (!team) return c.json({ error: "forbidden" }, 403);
  const info = await loadSession(c.env.DB, id);
  if (!info) return c.json({ error: "not_found" }, 404);
  if (info.race.ended) return c.json({ error: "race_ended" }, 409);
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown; to?: unknown };
  if (typeof body.text !== "string") return c.json({ error: "invalid" }, 400);
  const to = body.to === "stewards" ? "stewards" : "team";
  return doOf(c.env, id).fetch("http://do/cmd", {
    method: "POST",
    body: JSON.stringify({ cmd: { type: "teamRadio", team: team.id, teamName: team.name, text: body.text, to }, actor: me.username }),
  });
});

// Pit windows: a team plans them for its own cars, in time from the session start.
async function teamSession(c: Context<{ Bindings: Env }>) {
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (!me) return { error: c.json({ error: "unauthorized" }, 401) };
  const team = me.teams.find((t) => t.id === c.req.param("teamId"));
  if (!team) return { error: c.json({ error: "forbidden" }, 403) };
  const id = c.req.param("id") ?? "";
  const info = await loadSession(c.env.DB, id);
  if (!info) return { error: c.json({ error: "not_found" }, 404) };
  if (info.race.ended) return { error: c.json({ error: "race_ended" }, 409) };
  return { me, team, id, info };
}

app.post("/api/sessions/:id/team/:teamId/pit", async (c) => {
  const r = await teamSession(c);
  if ("error" in r) return r.error;
  const body = (await c.req.json().catch(() => ({}))) as { fromMs?: unknown; toMs?: unknown };
  const cmd = { type: "pitAdd", team: r.team.id, teamName: r.team.name, fromMs: Number(body.fromMs), toMs: Number(body.toMs), lengthMs: r.info.session.endsAt - r.info.session.startsAt };
  return doOf(c.env, r.id).fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd, actor: r.me.username }) });
});

// A team asks one of its drivers a question: Yes/No, or up to four options.
app.post("/api/sessions/:id/team/:teamId/ask", async (c) => {
  const r = await teamSession(c);
  if ("error" in r) return r.error;
  const body = (await c.req.json().catch(() => ({}))) as { driver?: unknown; text?: unknown; options?: unknown };
  const cmd = {
    type: "ask",
    team: r.team.id,
    teamName: r.team.name,
    driver: typeof body.driver === "string" ? body.driver : "",
    text: typeof body.text === "string" ? body.text : "",
    options: Array.isArray(body.options) ? body.options : undefined,
  };
  return doOf(c.env, r.id).fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd, actor: r.me.username }) });
});

// Driver side: answer a question, or write to the team. Any signed-in user; the reducer matches them to their run.
async function driverSession(c: Context<{ Bindings: Env }>) {
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (!me) return { error: c.json({ error: "unauthorized" }, 401) };
  const id = c.req.param("id") ?? "";
  const info = await loadSession(c.env.DB, id);
  if (!info) return { error: c.json({ error: "not_found" }, 404) };
  if (info.race.ended) return { error: c.json({ error: "race_ended" }, 409) };
  return { me, id };
}

app.post("/api/sessions/:id/driver/answer", async (c) => {
  const r = await driverSession(c);
  if ("error" in r) return r.error;
  const body = (await c.req.json().catch(() => ({}))) as { msgId?: unknown; index?: unknown };
  const cmd = { type: "answer", msgId: typeof body.msgId === "string" ? body.msgId : "", index: Number(body.index) };
  return doOf(c.env, r.id).fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd, actor: r.me.username }) });
});

app.post("/api/sessions/:id/driver/radio", async (c) => {
  const r = await driverSession(c);
  if ("error" in r) return r.error;
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
  const cmd = { type: "driverRadio", text: typeof body.text === "string" ? body.text : "" };
  return doOf(c.env, r.id).fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd, actor: r.me.username }) });
});

// Self-timed practice: a team fixes the times of its own cars (DNF, attribute or remove a time, enter a time).
const TEAM_RUN_CMDS = ["cadence", "dnf", "undnf", "assign", "unattribute", "reattribute", "setTime", "setMode", "lap", "queueAgain"];
app.post("/api/sessions/:id/team/:teamId/run", async (c) => {
  const r = await teamSession(c);
  if ("error" in r) return r.error;
  if (r.info.session.type === "race") return c.json({ error: "race_timing_off" }, 409);
  if (!r.info.session.selfTimed) return c.json({ error: "not_self_timed" }, 409);
  const body = (await c.req.json().catch(() => null)) as { type?: unknown } | null;
  if (!body || typeof body.type !== "string" || !TEAM_RUN_CMDS.includes(body.type)) return c.json({ error: "invalid" }, 400);
  const cmd = { ...body, team: r.team.id };
  return doOf(c.env, r.id).fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd, actor: r.me.username }) });
});

// A team's notes about its own drivers, in any session.
app.post("/api/sessions/:id/team/:teamId/note", async (c) => {
  const r = await teamSession(c);
  if ("error" in r) return r.error;
  const body = (await c.req.json().catch(() => null)) as { type?: unknown; runId?: unknown; text?: unknown; id?: unknown } | null;
  const cmd =
    body?.type === "teamNote"
      ? { type: "teamNote", team: r.team.id, runId: typeof body.runId === "string" ? body.runId : "", text: typeof body.text === "string" ? body.text : "" }
      : body?.type === "teamNoteDel"
        ? { type: "teamNoteDel", team: r.team.id, id: typeof body.id === "string" ? body.id : "" }
        : null;
  if (!cmd) return c.json({ error: "invalid" }, 400);
  return doOf(c.env, r.id).fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd, actor: r.me.username }) });
});

// Self-timed practice: a team puts its own queued cars in the order it wants.
app.post("/api/sessions/:id/team/:teamId/move", async (c) => {
  const r = await teamSession(c);
  if ("error" in r) return r.error;
  if (r.info.session.type === "race") return c.json({ error: "race_timing_off" }, 409);
  if (!r.info.session.selfTimed) return c.json({ error: "not_self_timed" }, 409);
  const body = (await c.req.json().catch(() => ({}))) as { runId?: unknown; dir?: unknown };
  const cmd = { type: "teamMove", team: r.team.id, runId: typeof body.runId === "string" ? body.runId : "", dir: body.dir === -1 ? -1 : body.dir === 1 ? 1 : 0 };
  return doOf(c.env, r.id).fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd, actor: r.me.username }) });
});

// Self-timed practice: the team starts and stops its own cars.
app.post("/api/sessions/:id/team/:teamId/timing", async (c) => {
  const r = await teamSession(c);
  if ("error" in r) return r.error;
  if (r.info.session.type === "race") return c.json({ error: "race_timing_off" }, 409);
  if (!r.info.session.selfTimed) return c.json({ error: "not_self_timed" }, 409);
  const body = (await c.req.json().catch(() => ({}))) as { action?: unknown; runId?: unknown };
  // Server time decides: Go only while the session runs, Stop only once it has started.
  const now = Date.now();
  if (now < r.info.session.startsAt) return c.json({ error: "not_started" }, 409);
  if (body.action === "go" && now >= r.info.session.endsAt) return c.json({ error: "session_ended" }, 409);
  const cmd =
    body.action === "go"
      ? { type: "teamGo", team: r.team.id }
      : body.action === "finish"
        ? { type: "teamFinish", team: r.team.id, runId: typeof body.runId === "string" ? body.runId : undefined }
        : null;
  if (!cmd) return c.json({ error: "invalid" }, 400);
  return doOf(c.env, r.id).fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd, actor: r.me.username }) });
});

app.delete("/api/sessions/:id/team/:teamId/pit/:wid", async (c) => {
  const r = await teamSession(c);
  if ("error" in r) return r.error;
  const cmd = { type: "pitDel", team: r.team.id, id: c.req.param("wid") };
  return doOf(c.env, r.id).fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd, actor: r.me.username }) });
});

// Whether the signed-in user may steward this race (drives the UI gate; the API checks again).
app.get("/api/sessions/:id/access", async (c) => {
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  const info = await loadSession(c.env.DB, c.req.param("id"));
  return c.json({ steward: !!info && (await isRaceSteward(c.env, me, info.race.id)) });
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
