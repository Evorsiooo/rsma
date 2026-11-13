import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { CUT_LABEL, GROUP_URL, REG_KIND_LABEL, type RegistrationView, type RegSummary, type RegTeam } from "../shared/registration";
import { PANEL_ROLES, hasAny } from "../shared/teams";
import type { RaceSummary, SessionSummary } from "../shared/types";
import { api, registrationApi } from "./api";
import { NotFound } from "./NotFound";
import { Bd, Box } from "./site/parts";
import { toast } from "./ui";

const ERRORS: Record<string, string> = {
  not_open: "Registration is not open.",
  taken: "Already registered, by another team or as an independent.",
  not_member: "That person is not in this team.",
  wrong_role: "Drivers need the Driver role, employees a staff role.",
  no_such_roblox_user: "No Roblox user with that name.",
  lookup_failed: "Could not reach Roblox. Try again in a moment.",
  invalid: "Invalid value.",
  picks_closed: "The time to choose drivers for this session has passed.",
  too_many: "That session is full for your team. Untick a driver first.",
  not_registered: "Only registered drivers of the team can be chosen.",
  forbidden: "Not allowed.",
};
const say = (e: string) => toast(ERRORS[e] ?? "Request failed.");

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Res = { ok: true } | { ok: false; error: string };
type Act = (p: Promise<Res>) => Promise<boolean>;

/** Old per-session address: forward to the event's page. */
export function RegisterRedirect() {
  const { id = "" } = useParams();
  const [to, setTo] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api.session(id).then((i) => setTo(`/race/${i.race.id}/register`), () => setTo(null));
  }, [id]);
  if (to === null) return <NotFound />;
  return to ? <Navigate to={to} replace /> : null;
}

/** /race/:id/register: a team registers its people once for the event; limited sessions are chosen per session. */
export function EventRegistration() {
  const { id = "" } = useParams();
  const [race, setRace] = useState<RaceSummary | null | undefined>(undefined);
  const [regs, setRegs] = useState<RegSummary[]>([]);
  const [views, setViews] = useState<Record<string, RegistrationView>>({});
  const [ready, setReady] = useState(false);
  const load = useCallback(async () => {
    const [races, list] = await Promise.all([api.races(), registrationApi.list()]);
    const r = races.find((x) => x.id === id) ?? null;
    setRace(r);
    setRegs(list);
    if (!r) return;
    const mine = list.filter((g) => r.sessions.some((s) => s.id === g.sessionId));
    const got = await Promise.all(mine.map((g) => registrationApi.get(g.sessionId).then((v) => [g.sessionId, v] as const, () => null)));
    setViews(Object.fromEntries(got.filter((x): x is readonly [string, RegistrationView] => !!x)));
    setReady(true);
  }, [id]);
  useEffect(() => {
    load().catch(() => setRace(null));
  }, [load]);
  // After an action only the registration views change; the race list and windows stay as they were.
  const refresh = useCallback(async () => {
    const got = await Promise.all(Object.keys(views).map((sid) => registrationApi.get(sid).then((v) => [sid, v] as const, () => null)));
    setViews((cur) => ({ ...cur, ...Object.fromEntries(got.filter((x): x is readonly [string, RegistrationView] => !!x)) }));
  }, [views]);
  const act: Act = async (p) => {
    const r = await p;
    if (!r.ok) say(r.error);
    await refresh();
    return r.ok;
  };

  if (race === null) return <NotFound />;
  if (!race || !ready) return <Box title="Registration"><Bd><div className="note">Loading...</div></Bd></Box>;
  const now = Date.now();
  const mine = regs.filter((g) => race.sessions.some((s) => s.id === g.sessionId));
  const roots = [...new Set(mine.map((g) => g.root))].filter((r) => views[r]?.settings);
  const byId = (sid: string) => race.sessions.find((s) => s.id === sid) as SessionSummary;
  if (roots.length === 0) return <NotFound />;
  return (
    <>
      <div style={{ fontSize: 12 }} className="note">
        <b style={{ color: "var(--s-ink)" }}>{race.name} · team registration</b>
      </div>
      {roots.map((root) => {
        const sessions = race.sessions.filter((s) => mine.some((g) => g.sessionId === s.id && g.root === root)).sort((a, b) => a.startsAt - b.startsAt);
        return <Group key={root} root={root} sessions={sessions.map((s) => byId(s.id))} views={views} act={act} />;
      })}
    </>
  );
}

function Group({ root, sessions, views, act }: { root: string; sessions: SessionSummary[]; views: Record<string, RegistrationView>; act: Act }) {
  const rv = views[root];
  const s = rv.settings!;
  const phase = rv.phase;
  const names = sessions.map((x) => x.name).join(", ");
  const status = phase === "upcoming" ? `Registration opens ${fmt.format(s.opensAt)}` : phase === "open" ? `Registration open until ${fmt.format(s.deadline)}` : `Registration closed ${fmt.format(s.deadline)}`;
  return (
    <>
      <Box title={names}>
        <Bd>{status}</Bd>
      </Box>
      {phase !== "upcoming" &&
        (rv.teams.length === 0 ? (
          <Box title="Team Registration"><Bd><div className="note">Only a Team Principal or Sporting Director can register a team.</div></Bd></Box>
        ) : (
          rv.teams.map((t) => <TeamBox key={t.id} team={t} root={root} sessions={sessions} views={views} act={act} />)
        ))}
    </>
  );
}

function TeamBox({ team, root, sessions, views, act }: { team: RegTeam; root: string; sessions: SessionSummary[]; views: Record<string, RegistrationView>; act: Act }) {
  const rv = views[root];
  const open = rv.phase === "open";
  const regs = rv.registrations.filter((r) => r.teamId === team.id);
  const drivers = team.members.filter((m) => m.roles.includes("driver"));
  const staff = team.members.filter((m) => hasAny(m.roles, PANEL_ROLES));
  const registered = (uid: string, kind: string) => regs.some((r) => r.userId === uid && r.kind === kind);
  // A tick shows at once; the server answer replaces it, and a rejected tick springs back with a message.
  const [opt, setOpt] = useState<Record<string, boolean>>({});
  const shownOn = (key: string, real: boolean) => opt[key] ?? real;
  const settle = async (key: string, want: boolean, p: Promise<Res>) => {
    setOpt((o) => ({ ...o, [key]: want }));
    await act(p);
    setOpt((o) => { const n = { ...o }; delete n[key]; return n; });
  };
  const toggle = (m: { id: string; username: string }, kind: "driver" | "employee") => {
    const on = registered(m.id, kind);
    return settle(`${kind}:${m.id}`, !on, on ? registrationApi.teamRemove(root, team.id, m.id) : registrationApi.teamAdd(root, team.id, m.username, kind));
  };
  const guests = regs.filter((r) => r.kind === "spectator");
  const [name, setName] = useState("");
  const [find, setFind] = useState("");
  const shown = drivers.filter((m) => m.username.toLowerCase().includes(find.trim().toLowerCase()));
  const now = Date.now();
  const cutIn = (sid: string, uid: string) => views[sid]?.registrations.find((r) => r.teamId === team.id && r.userId === uid && r.kind === "driver")?.cut;
  const pickable = (sid: string) => {
    const v = views[sid];
    return v?.settings?.teamLimit != null && v.pickUntil != null && now <= v.pickUntil;
  };
  const sel = (sid: string) => new Set(drivers.filter((m) => shownOn(`pick:${sid}:${m.id}`, cutIn(sid, m.id) === "in")).map((m) => m.id));
  // Applies at once, like Registered; the server enforces the limit and the cutoff.
  const flip = async (sid: string, uid: string) => {
    const n = sel(sid);
    n.has(uid) ? n.delete(uid) : n.add(uid);
    await settle(`pick:${sid}:${uid}`, n.has(uid), registrationApi.setPicks(sid, team.id, [...n]));
  };
  const limited = sessions.filter((x) => pickable(x.id));
  return (
    <>
      <Box title={`${team.name} · Drivers`}>
        <Bd style={{ borderBottom: "1px dotted var(--s-line-l)" }}>
          Registered drivers must {" "}
          <a href={GROUP_URL} target="_blank" rel="noreferrer">join the RSMA Roblox group</a> (a pending request counts) before the deadline, or they cannot race.
          {limited.length > 0 && " Where a session limits drivers per team, choose who takes part until its cutoff."}
        </Bd>
        {drivers.length === 0 ? (
          <Bd><div className="note">No member has the Driver role.</div></Bd>
        ) : (
          <>
          <Bd top bar>
            <input type="search" style={{ flex: 1, minWidth: 180 }} placeholder="Search drivers" aria-label="Search drivers" value={find} onChange={(e) => setFind(e.target.value)} />
            {find.trim() && <span className="mute">{shown.length} of {drivers.length}</span>}
          </Bd>
          <Bd flush>
            <table className="t">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Registered</th>
                  {sessions.map((x) => (
                    <th key={x.id}>{x.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={2 + sessions.length} className="mute">No driver matches.</td>
                  </tr>
                )}
                {shown.map((m) => {
                  const on = shownOn(`driver:${m.id}`, registered(m.id, "driver"));
                  return (
                    <tr key={m.id}>
                      <td>{m.username}</td>
                      <td>
                        <input type="checkbox" aria-label={`${m.username} registered`} checked={on} disabled={!open} onChange={() => toggle(m, "driver")} />
                      </td>
                      {sessions.map((x) => {
                        const cut = cutIn(x.id, m.id);
                        if (!on || !cut) return <td key={x.id} className="mute">{""}</td>;
                        if (pickable(x.id) && (cut === "in" || cut === "out")) {
                          const limit = views[x.id].settings!.teamLimit!;
                          const set = sel(x.id);
                          return (
                            <td key={x.id}>
                              <label className="plain">
                                <input type="checkbox" checked={set.has(m.id)} disabled={!set.has(m.id) && set.size >= limit} onChange={() => flip(x.id, m.id)} /> Take part
                              </label>
                            </td>
                          );
                        }
                        return <td key={x.id}>{CUT_LABEL[cut]}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Bd>
          </>
        )}
        {limited.map((x) => (
          <Bd key={x.id} top>
            <span className="mute">{x.name}: {sel(x.id).size} of {views[x.id].settings!.teamLimit} drivers take part · choose until {fmt.format(views[x.id].pickUntil!)}</span>
          </Bd>
        ))}
      </Box>
      {(staff.length > 0 || guests.length > 0 || open) && (
        <Box title={`${team.name} · Staff and guests`}>
          <Bd flush>
            <table className="t">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((m) => (
                  <tr key={m.id}>
                    <td>{m.username}</td>
                    <td className="mute">{REG_KIND_LABEL.employee}</td>
                    <td>
                      <input type="checkbox" aria-label={`${m.username} registered as employee`} checked={shownOn(`employee:${m.id}`, registered(m.id, "employee"))} disabled={!open} onChange={() => toggle(m, "employee")} />
                    </td>
                  </tr>
                ))}
                {guests.map((r) => (
                  <tr key={r.userId}>
                    <td>{r.username}</td>
                    <td className="mute">{REG_KIND_LABEL.spectator}</td>
                    <td className="n">{open && <button className="btn sm red" onClick={() => act(registrationApi.teamRemove(root, team.id, r.userId))}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Bd>
          {open && (
            <Bd top bar>
              <input type="text" style={{ flex: 1, minWidth: 180 }} placeholder="Spectator Roblox username" aria-label="Spectator username" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn pri" disabled={!name.trim()} onClick={async () => { if (await act(registrationApi.teamAdd(root, team.id, name.trim(), "spectator"))) setName(""); }}>
                Add spectator
              </button>
            </Bd>
          )}
        </Box>
      )}
    </>
  );
}
