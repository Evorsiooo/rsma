import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { carName, CUT_LABEL, driverUnit, fullNotice, GROUP_URL, lineupLine, moveRank, orderRule, REG_KIND_LABEL, REG_KINDS, spotsLine, statusText, type Car, type EventView, type RegistrationView, type RegTeam } from "../shared/registration";
import { PANEL_ROLES, hasAny } from "../shared/teams";
import type { SessionSummary } from "../shared/types";
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
  car_limit: "Your team has entered all the cars it is allowed.",
  number_taken: "Another car has that number.",
  in_other_car: "A driver can only be in one car.",
  lineup_locked: "Lineups are locked. Ask the stewards to change them.",
  not_found: "That car no longer exists.",
  forbidden: "Not allowed.",
  unauthorized: "You are signed out. Sign in again.",
  network: "Could not reach the server. Check your connection.",
};
const say = (e: string) => toast(ERRORS[e] ?? "Request failed.");

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Res = { ok: true; data?: unknown } | { ok: false; error: string };
/**
 * Runs one change. Changes go to the server one after another, in the order they were made, so a quick second click
 * can never overtake the first. With a key, the box shows the wanted state at once until the changes are done.
 */
type Act = (call: () => Promise<Res>, tick?: { key: string; want: boolean } | { car: string; order: string[] }) => Promise<boolean>;

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
  const [ev, setEv] = useState<EventView | null | undefined>(undefined);
  // What the boxes show while changes are on their way: key -> wanted state.
  const [opt, setOpt] = useState<Record<string, boolean>>({});
  // The lineup order a car shows while a change to it is on its way: car id -> driver ids.
  const [ord, setOrd] = useState<Record<string, string[]>>({});
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const failed = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const reload = useCallback(() => registrationApi.event(id).then((e) => live.current && setEv(e), () => live.current && setEv((cur) => cur ?? null)), [id]);
  useEffect(() => {
    reload();
  }, [reload]);
  // Every answer carries the whole event as it is after that change, so there is nothing to reload on success.
  // After a rejected or lost change the page is reloaded once, so what it shows is what the server has.
  const act: Act = (call, tick) => {
    if (tick && "car" in tick) setOrd((o) => ({ ...o, [tick.car]: tick.order }));
    else if (tick) setOpt((o) => ({ ...o, [tick.key]: tick.want }));
    pending.current++;
    const task = chain.current.then(async () => {
      let ok = false;
      try {
        const r = await call();
        if (r.ok) {
          ok = true;
          const e = (r.data as { event?: EventView } | undefined)?.event;
          if (e && live.current) setEv(e);
        } else {
          failed.current = true;
          say(r.error);
        }
      } catch {
        failed.current = true;
        say("network");
      }
      if (--pending.current === 0) {
        if (failed.current) {
          failed.current = false;
          await reload();
        }
        if (live.current) {
          setOpt({});
          setOrd({});
        }
      }
      return ok;
    });
    chain.current = task;
    return task;
  };

  if (ev === null) return <NotFound />;
  if (!ev) return <Box title="Registration"><Bd><div className="note">Loading...</div></Bd></Box>;
  const race = ev.race;
  const views: Record<string, RegistrationView> = Object.fromEntries(Object.entries(ev.sessions).map(([sid, v]) => [sid, v.view]));
  const mine = Object.entries(ev.sessions).map(([sessionId, v]) => ({ sessionId, root: v.root }));
  const roots = [...new Set(mine.map((g) => g.root))].filter((r) => views[r]?.settings);
  const byId = (sid: string) => race.sessions.find((s) => s.id === sid) as SessionSummary;
  if (roots.length === 0) return <NotFound />;
  return (
    <>
      <div style={{ fontSize: 12 }} className="note">
        <b style={{ color: "var(--s-ink)" }}>{race.name} · team registration</b>
      </div>
      {roots.map((root) => {
        // A session that is over is not registered for any more.
        const sessions = race.sessions.filter((s) => s.endsAt > Date.now() && mine.some((g) => g.sessionId === s.id && g.root === root)).sort((a, b) => a.startsAt - b.startsAt);
        if (sessions.length === 0) return null;
        return <Group key={root} root={root} sessions={sessions.map((s) => byId(s.id))} views={views} opt={opt} ord={ord} act={act} />;
      })}
    </>
  );
}

function Group({ root, sessions, views, opt, ord, act }: { root: string; sessions: SessionSummary[]; views: Record<string, RegistrationView>; opt: Record<string, boolean>; ord: Record<string, string[]>; act: Act }) {
  const rv = views[root];
  const s = rv.settings!;
  const phase = rv.phase;
  const names = sessions.map((x) => x.name).join(", ");
  const status = phase === "upcoming" ? `Registration opens ${fmt.format(s.opensAt)}` : phase === "open" ? `Registration open until ${fmt.format(s.deadline)}` : `Registration closed ${fmt.format(s.deadline)}`;
  return (
    <>
      <Box title={names}>
        <Bd>{status}</Bd>
        {phase !== "upcoming" && (
          <Bd top>
            {REG_KINDS.filter((k) => rv.counts[k].spots > 0).map((k) => (
              <div key={k}>{k === "driver" && s.endurance ? "Car" : REG_KIND_LABEL[k]} spots: {spotsLine(rv.counts[k], k === "driver" ? (s.endurance ? driverUnit(s) : "") : "")}</div>
            ))}
            {sessions.length > 1 && <div className="mute">One list of spots for {names}. Everyone gets the same result in all of them.</div>}
            <div className="mute">{orderRule(s)}</div>
            {phase === "open" && (() => {
              const n = fullNotice(rv.counts.driver, "driver", { ownReserved: rv.teams.some((t) => t.factory), team: true });
              return n && <div style={{ marginTop: 6 }}><b>{n}</b></div>;
            })()}
          </Bd>
        )}
      </Box>
      {phase !== "upcoming" &&
        (rv.teams.length === 0 ? (
          <Box title="Team Registration"><Bd><div className="note">Only a Team Principal or Sporting Director can register a team.</div></Bd></Box>
        ) : (
          rv.teams.map((t) => <TeamBox key={t.id} team={t} root={root} sessions={sessions} views={views} opt={opt} ord={ord} act={act} />)
        ))}
    </>
  );
}

function TeamBox({ team, root, sessions, views, opt, ord, act }: { team: RegTeam; root: string; sessions: SessionSummary[]; views: Record<string, RegistrationView>; opt: Record<string, boolean>; ord: Record<string, string[]>; act: Act }) {
  const rv = views[root];
  const open = rv.phase === "open";
  const regs = rv.registrations.filter((r) => r.teamId === team.id);
  const drivers = team.members.filter((m) => m.roles.includes("driver"));
  const staff = team.members.filter((m) => hasAny(m.roles, PANEL_ROLES));
  const registered = (uid: string, kind: string) => regs.some((r) => r.userId === uid && r.kind === kind);
  // A tick shows at once; the server's answer replaces it, and a rejected tick springs back with a message.
  const shownOn = (key: string, real: boolean) => opt[key] ?? real;
  // What a click does follows what the box shows, so a second click always undoes the first.
  const toggle = (m: { id: string; username: string }, kind: "driver" | "employee") => {
    const key = `${kind}:${m.id}`;
    const want = !shownOn(key, registered(m.id, kind));
    return act(() => (want ? registrationApi.teamAdd(root, team.id, m.username, kind) : registrationApi.teamRemove(root, team.id, m.id, kind === "employee" ? "employee" : undefined)), { key, want });
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
  const flip = (sid: string, uid: string) => {
    const n = sel(sid);
    n.has(uid) ? n.delete(uid) : n.add(uid);
    return act(() => registrationApi.setPicks(sid, team.id, [...n]), { key: `pick:${sid}:${uid}`, want: n.has(uid) });
  };
  const limited = sessions.filter((x) => pickable(x.id));
  // Only sessions that limit drivers per team get their own column; everyone else has one result for the whole group.
  const limitedCols = sessions.filter((x) => views[x.id]?.settings?.teamLimit != null);
  const own = (uid: string) => regs.find((r) => r.userId === uid && r.kind === "driver");
  const endurance = !!rv.settings?.endurance;
  const cars = new Map(rv.cars.map((c) => [c.id, c]));
  // In an endurance event a driver's place is the car and the seat in it.
  const carStatus = (r: { carId: string | null; rank: number | null; cut: string; waitPos: number | null }) => {
    const c = r.carId ? cars.get(r.carId) : null;
    if (!c) return r.cut === "denied" ? "Denied" : "No car";
    return `${carName(c)} · ${r.rank! <= c.seats ? `Race ${r.rank}` : `Reserve ${r.rank! - c.seats}`}`;
  };
  return (
    <>
      {!endurance && <Box title={`${team.name} · Drivers`}>
        <Bd style={{ borderBottom: "1px dotted var(--s-line-l)" }}>
          {(() => {
            const ds = regs.filter((r) => r.kind === "driver");
            const n = (c: string) => ds.filter((r) => r.cut === c || (c === "in" && r.cut === "out")).length;
            return ds.length > 0 ? <div style={{ marginBottom: 6 }}><b>{ds.length} registered: {n("in")} In{n("waitlist") > 0 ? `, ${n("waitlist")} Waiting` : ""}{n("denied") > 0 ? `, ${n("denied")} Denied` : ""}.</b></div> : null;
          })()}
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
                  <th>Status</th>
                  {limitedCols.map((x) => (
                    <th key={x.id}>{x.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={3 + limitedCols.length} className="mute">No driver matches.</td>
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
                      <td>{on && own(m.id) ? (endurance ? carStatus(own(m.id)!) : own(m.id)!.cut === "out" ? "In" : statusText(own(m.id)!)) : ""}</td>
                      {limitedCols.map((x) => {
                        const cut = cutIn(x.id, m.id);
                        if (!on || !cut || cut === "waitlist" || cut === "denied") return <td key={x.id} className="mute">{""}</td>;
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
                        return <td key={x.id}>{cut === "in" ? "Takes part" : CUT_LABEL[cut]}</td>;
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
      </Box>}
      {endurance && <CarsBox team={team} root={root} rv={rv} ord={ord} act={act} />}
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
                    <td className="n">{open && <button className="btn sm red" onClick={() => act(() => registrationApi.teamRemove(root, team.id, r.userId))}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Bd>
          {open && (
            <Bd top bar>
              <input type="text" style={{ flex: 1, minWidth: 180 }} placeholder="Spectator Roblox username" aria-label="Spectator username" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn pri" disabled={!name.trim()} onClick={async () => { if (await act(() => registrationApi.teamAdd(root, team.id, name.trim(), "spectator"))) setName(""); }}>
                Add spectator
              </button>
            </Bd>
          )}
        </Box>
      )}
    </>
  );
}

/**
 * Endurance events: the team's cars, each with its drivers in rank order. The top seats race, the rest are reserve.
 * A car is just a car (the number and plate are filled in on Flagman), and putting a driver in a car registers them.
 */
function CarsBox({ team, root, rv, ord, act }: { team: RegTeam; root: string; rv: RegistrationView; ord: Record<string, string[]>; act: Act }) {
  const s = rv.settings!;
  const locked = rv.lineupLock !== null && Date.now() > rv.lineupLock;
  const cars = rv.cars.filter((c) => c.teamId === team.id).sort((a, b) => a.at - b.at);
  const name = new Map(team.members.map((m) => [m.id, m.username]));
  const inCar = new Set(cars.flatMap((c) => c.drivers.map((d) => d.userId)));
  // The team's drivers who are in no car yet.
  const free = team.members.filter((m) => m.roles.includes("driver") && !inCar.has(m.id));
  const full = cars.length >= s.carsPerTeam;
  const order = (c: Car) => ord[c.id] ?? c.drivers.map((d) => d.userId);
  const setOrder = (c: Car, ids: string[]) => act(() => registrationApi.teamCarEdit(root, team.id, c.id, { drivers: ids }), { car: c.id, order: ids });
  // The number of racing drivers a car shows while the change to it is on its way. Read the chosen value now: the call runs later.
  const [want, setWant] = useState<Record<string, number>>({});
  const setSeats = (c: Car, seats: number) => {
    setWant((w) => ({ ...w, [c.id]: seats }));
    void act(() => registrationApi.teamCarEdit(root, team.id, c.id, { seats })).then(() => setWant((w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== c.id))));
  };
  const sorry = locked ? "Lineups are locked. Only the stewards can change them now." : "";
  return (
    <Box title={`${team.name} · Cars`}>
      <Bd>
        <div><b>{cars.length} of {s.carsPerTeam} cars entered.</b> Choose for each car how many drivers race (up to {s.seatsPerCar}). They are the first ones in its list, and any others are reserves.</div>
        <div className="mute">
          {rv.lineupLock !== null && !locked ? `Change lineups until ${fmt.format(rv.lineupLock)}. ` : ""}
          Putting a driver in a car registers them. Drivers must <a href={GROUP_URL} target="_blank" rel="noreferrer">join the RSMA Roblox group</a> (a pending request counts) before the deadline, or they cannot race.
        </div>
        {sorry && <div style={{ marginTop: 4 }}><b>{sorry}</b></div>}
      </Bd>
      {cars.map((c, n) => {
        const ids = order(c);
        const status = ids.length === 0 ? "Waiting, no drivers" : c.cut === "in" ? "In" : c.waitPos ? `Waiting, position ${c.waitPos}` : "Waiting";
        return (
          <div key={c.id}>
            <Bd top bar>
              <span style={{ flex: 1 }}>
                <b>Car {n + 1}</b> <span className="mute">· {lineupLine(ids.length, want[c.id] ?? c.seats)} · {status}</span>
              </span>
              <label className="bar">
                <span>Drivers racing</span>
                <select aria-label={`Drivers racing in car ${n + 1}`} value={want[c.id] ?? c.seats} disabled={locked} onChange={(e) => setSeats(c, Number(e.target.value))}>
                  {Array.from({ length: Math.max(s.seatsPerCar, c.seats) }, (_, k) => k + 1).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </label>
              <button className="btn sm red" disabled={locked} onClick={() => act(() => registrationApi.teamCarRemove(root, team.id, c.id))}>Remove car</button>
            </Bd>
            {ids.length > 0 && (
              <Bd flush>
                <table className="t" style={{ tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 120 }}>Seat</th>
                      <th>Driver</th>
                      <th style={{ width: 200 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {ids.map((u, i) => (
                      <tr key={u}>
                        <td style={{ whiteSpace: "nowrap" }}>{i < (want[c.id] ?? c.seats) ? `Driver ${i + 1}` : `Reserve ${i + 1 - (want[c.id] ?? c.seats)}`}</td>
                        <td>{name.get(u) ?? c.drivers.find((d) => d.userId === u)?.username ?? u}</td>
                        <td className="n" style={{ whiteSpace: "nowrap" }}>
                          <button className="btn sm" disabled={locked || i === 0} onClick={() => setOrder(c, moveRank(ids, i, -1))}>Up</button>{" "}
                          <button className="btn sm" disabled={locked || i === ids.length - 1} onClick={() => setOrder(c, moveRank(ids, i, 1))}>Down</button>{" "}
                          <button className="btn sm red" disabled={locked} onClick={() => setOrder(c, ids.filter((x) => x !== u))}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Bd>
            )}
            <Bd top bar>
              <select aria-label={`Add a driver to car ${n + 1}`} style={{ flex: 1, minWidth: 180 }} value="" disabled={locked || free.length === 0} onChange={(e) => e.target.value && setOrder(c, [...ids, e.target.value])}>
                <option value="">{free.length ? "Add a driver…" : "Every driver of your team is in a car"}</option>
                {free.map((m) => (
                  <option key={m.id} value={m.id}>{m.username}</option>
                ))}
              </select>
            </Bd>
          </div>
        );
      })}
      <Bd top bar>
        <button className="btn pri" disabled={locked || full} onClick={() => act(() => registrationApi.teamCarAdd(root, team.id, {}))}>Add car</button>
        {full && <span className="mute">Your team has entered all {s.carsPerTeam} cars it is allowed.</span>}
      </Bd>
    </Box>
  );
}
