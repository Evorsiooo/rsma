import { useCallback, useEffect, useState } from "react";
import { carName, driverUnit, inGroup, lineupLine, spotsLine, statusText, CUT_LABEL, REG_KIND_LABEL, REG_KINDS, type Car, type GroupStatus, type RegKind, type Registration, type RegistrationView } from "../../shared/registration";
import type { AdminRace } from "../../shared/types";
import { api, registrationApi } from "../api";
import { CodeDialog, useTokenMode } from "../access";
import { Dialog, toast } from "../ui";

const ERRORS: Record<string, string> = {
  taken: "Already registered, by another team or as an independent.",
  no_such_roblox_user: "No Roblox user with that name.",
  lookup_failed: "Could not reach Roblox. Try again in a moment.",
  invalid: "Invalid value.",
  forbidden: "Not allowed.",
  car_limit: "That team has entered all the cars it is allowed.",
  number_taken: "Another car has that number.",
  not_registered: "Only drivers the team has registered can be in a car.",
  in_other_car: "A driver can only be in one car.",
  too_many: "Too many drivers in one car.",
  not_endurance: "This event is not an endurance event.",
};
const clip = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const say = (e: string) => toast(ERRORS[e] ?? "Request failed.");

const dim = { color: "var(--r-text-dim)" } as const;

type Res = { ok: true } | { ok: false; error: string };

/** Staff review: everyone registered for one session, with deny, edit, remove and manual add. */
export function RegistrationsTab({ races }: { races: AdminRace[] }) {
  const [regIds, setRegIds] = useState<Set<string> | null>(null);
  const [sid, setSid] = useState("");
  const [view, setView] = useState<RegistrationView | null>(null);
  useEffect(() => {
    registrationApi.list().then((l) => setRegIds(new Set(l.filter((r) => r.root === r.sessionId).map((r) => r.sessionId))), () => setRegIds(new Set()));
  }, []);
  const options = races.flatMap((r) => r.sessions.filter((s) => regIds?.has(s.id)).map((s) => ({ id: s.id, label: `${r.name} · ${s.name}` })));
  const current = options.find((o) => o.id === sid)?.id ?? options[0]?.id ?? "";
  const load = useCallback(() => (current ? registrationApi.get(current).then(setView, () => setView(null)) : Promise.resolve()), [current]);
  useEffect(() => {
    setView(null);
    load();
  }, [load]);
  const act = async (p: Promise<Res>) => {
    const r = await p;
    if (!r.ok) say(r.error);
    await load();
    return r.ok;
  };
  if (!regIds) return null;
  if (options.length === 0) return <div className="r-panel"><div className="r-header">Registrations</div><div className="r-empty">No session has registration open. Turn it on from a session in Races.</div></div>;
  return (
    <>
      <div className="r-select">
        <select aria-label="Session" value={current} onChange={(e) => setSid(e.target.value)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      {view && (
        <div className="r-panel">
          <div className="r-header">Spots</div>
          <table className="r-table">
            <tbody>
              {REG_KINDS.map((k) => (
                <tr key={k}>
                  <td className="is-left">{k === "driver" && view.settings?.endurance ? "Cars" : `${REG_KIND_LABEL[k]}s`}</td>
                  <td>{spotsLine(view.counts[k], k === "driver" ? (view.settings?.endurance ? driverUnit(view.settings) : "") : "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view?.settings?.endurance && <CarsSection view={view} sid={current} act={act} />}
      {view && <StaffSection view={view} sid={current} act={act} />}
    </>
  );
}

export function StaffSection({ view, sid, act }: { view: RegistrationView; sid: string; act: (p: Promise<Res>) => Promise<boolean> }) {
  const [edit, setEdit] = useState<Registration | null>(null);
  const [adding, setAdding] = useState(false);
  const tokens = useTokenMode();
  const [codeFor, setCodeFor] = useState<Registration | null>(null);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api.teams().then(setTeams, () => {});
  }, []);
  const order = { in: 0, out: 1, waitlist: 2, denied: 3 } as const;
  const endurance = !!view.settings?.endurance;
  const cars = new Map(view.cars.map((c) => [c.id, c]));
  const carOf = (r: Registration) => {
    if (r.kind !== "driver" || !r.teamId) return "";
    const c = r.carId ? cars.get(r.carId) : null;
    return c ? `${carName(c)} · ${r.rank! <= c.seats ? `Race ${r.rank}` : `Reserve ${r.rank! - c.seats}`}` : "No car";
  };
  const rows = [...view.registrations].sort((a, b) => REG_KINDS.indexOf(a.kind) - REG_KINDS.indexOf(b.kind) || order[a.cut] - order[b.cut] || a.at - b.at);
  return (
    <div className="r-panel">
      <div className="r-header">All registrations</div>
      {rows.length === 0 ? (
        <div className="r-empty">Nobody registered.</div>
      ) : (
        <table className="r-table">
          <thead>
            <tr>
              <th className="is-left">Name</th>
              <th className="is-left" style={{ width: 80 }}>Type</th>
              <th className="is-left" style={{ width: 140 }}>Team</th>
              {endurance && <th className="is-left" style={{ width: 150 }}>Car</th>}
              <th className="is-left" style={{ width: 120 }}>Discord</th>
              <th style={{ width: 100 }}>Group</th>
              <th style={{ width: 150 }}>Status</th>
              <th style={{ width: tokens ? 320 : 240 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <td className="is-left" style={clip}>{r.username}</td>
                <td className="is-left" style={clip}>{REG_KIND_LABEL[r.kind]}</td>
                <td className="is-left" style={clip}>{r.teamName ?? "Independent"}</td>
                {endurance && <td className="is-left" style={{ ...dim, ...clip }}>{carOf(r)}</td>}
                <td className="is-left" style={{ ...dim, ...clip }}>{r.discord ?? ""}</td>
                <td>{r.kind === "driver" ? (inGroup(r.group) ? "In group" : "Not in group") : ""}</td>
                <td>{statusText(r)}</td>
                <td style={{ padding: 2 }}>
                  <div className="r-grid" style={{ ["--cols" as string]: tokens ? 4 : 3 }}>
                    <button className="r-cell" onClick={() => act(registrationApi.staffEdit(sid, r.userId, { denied: !r.denied }))}>{r.denied ? "Restore" : "Deny"}</button>
                    <button className="r-cell" onClick={() => setEdit(r)}>Edit</button>
                    {tokens && <button className="r-cell" disabled={!!r.teamId} onClick={() => setCodeFor(r)}>Code</button>}
                    <button className="r-cell r-cell--red" onClick={() => act(registrationApi.staffRemove(sid, r.userId))}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ padding: 4 }}>
        <button className="r-btn" style={{ width: 160 }} onClick={() => setAdding(true)}>Register someone</button>
      </div>
      {codeFor && <CodeDialog name={codeFor.username} issue={() => registrationApi.staffCode(sid, codeFor.userId)} onClose={() => setCodeFor(null)} />}
      {adding && <PersonDialog title="Register someone" teams={teams} onClose={() => setAdding(false)} onSave={async (v) => act(registrationApi.staffAdd(sid, { username: v.username!, kind: v.kind, teamId: v.teamId, discord: v.discord || undefined, group: v.group }))} />}
      {edit && (
        <PersonDialog
          title={`Edit ${edit.username}`}
          teams={teams}
          initial={edit}
          onClose={() => setEdit(null)}
          onSave={async (v) => act(registrationApi.staffEdit(sid, edit.userId, { kind: v.kind, teamId: v.teamId, group: v.group, discord: v.discord || undefined }))}
        />
      )}
    </div>
  );
}

interface PersonValues {
  username?: string;
  kind: RegKind;
  teamId: string | null;
  group: GroupStatus;
  discord: string;
}

function PersonDialog({ title, teams, initial, onSave, onClose }: { title: string; teams: { id: string; name: string }[]; initial?: Registration; onSave: (v: PersonValues) => Promise<boolean>; onClose: () => void }) {
  const [v, setV] = useState<PersonValues>({ username: "", kind: initial?.kind ?? "driver", teamId: initial ? initial.teamId : null, group: initial?.group ?? "unverified", discord: initial?.discord ?? "" });
  const ok = initial ? true : !!v.username?.trim();
  return (
    <Dialog
      title={title}
      size="l"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn" disabled={!ok} onClick={async () => { if (await onSave({ ...v, username: v.username?.trim() })) onClose(); }}>Save</button>
        </>
      }
    >
      {!initial && <input className="r-field" placeholder="Roblox username" aria-label="Roblox username" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} />}
      <div className="r-select">
        <select aria-label="Type" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as RegKind })}>
          {REG_KINDS.map((k) => <option key={k} value={k}>{REG_KIND_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="r-select">
        <select aria-label="Team" value={v.teamId ?? ""} onChange={(e) => setV({ ...v, teamId: e.target.value || null })}>
          <option value="">Independent</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <label className="r-check">
        <input type="checkbox" checked={inGroup(v.group)} onChange={(e) => setV({ ...v, group: e.target.checked ? "pending" : "unverified" })} />
        <span>Joined the RSMA Roblox group or request pending</span>
      </label>
      <input className="r-field" placeholder="Discord username" aria-label="Discord username" value={v.discord} onChange={(e) => setV({ ...v, discord: e.target.value })} />
    </Dialog>
  );
}

type Res2 = { ok: true } | { ok: false; error: string };

/** Endurance events: the cars teams have entered, with their ranked drivers. Staff add, change and remove them. */
function CarsSection({ view, sid, act }: { view: RegistrationView; sid: string; act: (p: Promise<Res2>) => Promise<boolean> }) {
  const [edit, setEdit] = useState<Car | "new" | null>(null);
  const s = view.settings!;
  const rows = [...view.cars].sort((a, b) => a.teamName.localeCompare(b.teamName) || a.at - b.at);
  return (
    <div className="r-panel">
      <div className="r-header">Cars</div>
      {rows.length === 0 ? (
        <div className="r-empty">No car entered yet. Up to {s.carsPerTeam} per team, {s.seatsPerCar} drivers racing in each.</div>
      ) : (
        <table className="r-table">
          <thead>
            <tr>
              <th className="is-left" style={{ width: 140 }}>Team</th>
              <th className="is-left" style={{ width: 170 }}>Car</th>
              <th className="is-left">Drivers, in rank order</th>
              <th style={{ width: 150 }}>Status</th>
              <th style={{ width: 160 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="is-left" style={clip}>{c.teamName}</td>
                <td className="is-left" style={clip}>{carName(c)}</td>
                <td className="is-left" style={clip}>{c.drivers.length ? `${c.drivers.map((d) => (d.race ? d.username : `${d.username} (reserve)`)).join(", ")}` : <span style={dim}>No drivers</span>}</td>
                <td>{c.drivers.length === 0 ? CUT_LABEL.waitlist : c.cut === "waitlist" && c.waitPos ? `Waiting, position ${c.waitPos}` : c.cut === "in" ? "In" : "Waiting"}</td>
                <td style={{ padding: 2 }}>
                  <div className="r-grid" style={{ ["--cols" as string]: 2 }}>
                    <button className="r-cell" onClick={() => setEdit(c)}>Edit</button>
                    <button className="r-cell r-cell--red" onClick={() => act(registrationApi.carRemove(sid, c.id))}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ padding: 4 }}>
        <button className="r-btn" style={{ width: 160 }} onClick={() => setEdit("new")}>Add a car</button>
      </div>
      {edit && <CarDialog view={view} car={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSave={(b, teamId) => act(edit === "new" ? registrationApi.carAdd(sid, { ...b, teamId: teamId! }) : registrationApi.carEdit(sid, edit.id, b))} />}
    </div>
  );
}

function CarDialog({ view, car, onSave, onClose }: { view: RegistrationView; car: Car | null; onSave: (b: { label: string; number: string; plate: string; seats: number; drivers: string[] }, teamId: string | null) => Promise<boolean>; onClose: () => void }) {
  const s = view.settings!;
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api.teams().then(setTeams, () => {});
  }, []);
  const [teamId, setTeamId] = useState<string>(car?.teamId ?? "");
  const [v, setV] = useState({ label: car?.label ?? "", number: car?.number ?? "", plate: car?.plate ?? "", seats: String(car?.seats ?? s.seatsPerCar) });
  const [drivers, setDrivers] = useState<string[]>(car?.drivers.map((d) => d.userId) ?? []);
  const [add, setAdd] = useState("");
  const team = car?.teamId ?? teamId;
  // The team's registered drivers who are not in another car.
  const name = new Map(view.registrations.map((r) => [r.userId, r.username]));
  const free = view.registrations.filter((r) => r.kind === "driver" && r.teamId === team && !r.denied && !drivers.includes(r.userId) && (!r.carId || r.carId === car?.id));
  const seats = /^\d+$/.test(v.seats) ? Number(v.seats) : NaN;
  const move = (i: number, by: number) => setDrivers((l) => {
    const next = [...l];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    return next;
  });
  const ok = !!team && seats >= 1 && seats <= Math.max(s.seatsPerCar, car?.seats ?? 0);
  return (
    <Dialog
      title={car ? `Edit ${carName(car)}` : "Add a car"}
      size="l"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn pri" disabled={!ok} onClick={async () => { if (await onSave({ label: v.label, number: v.number, plate: v.plate, seats, drivers }, car ? null : teamId)) onClose(); }}>Save</button>
        </>
      }
    >
      {!car && (
        <div className="r-select">
          <select aria-label="Team" value={teamId} onChange={(e) => { setTeamId(e.target.value); setDrivers([]); setAdd(""); }}>
            <option value="">Choose a team</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <input className="r-field" placeholder="Car name" aria-label="Car name" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} />
      <div className="r-row">
        <input className="r-field r-fill" placeholder="Number" aria-label="Car number" value={v.number} onChange={(e) => setV({ ...v, number: e.target.value })} />
        <input className="r-field r-fill" placeholder="Plate" aria-label="Plate" value={v.plate} onChange={(e) => setV({ ...v, plate: e.target.value })} />
      </div>
      <label className="r-row" style={{ alignItems: "center" }}>
        <span style={{ width: 240, flex: "none" }}>Drivers racing (at most {s.seatsPerCar})</span>
        <input className="r-field r-fill" inputMode="numeric" aria-label="Drivers racing" value={v.seats} onChange={(e) => setV({ ...v, seats: e.target.value })} />
      </label>
      <div style={dim}>Drivers, in rank order</div>
      {drivers.length === 0 ? (
        <div className="r-empty">No drivers yet.</div>
      ) : (
        <table className="r-table">
          <tbody>
            {drivers.map((u, i) => (
              <tr key={u}>
                <td style={{ width: 90 }} className="is-left">{i < (seats || 0) ? "Race" : "Reserve"}</td>
                <td className="is-left" style={clip}>{name.get(u) ?? u}</td>
                <td style={{ width: 210, padding: 2 }}>
                  <div className="r-grid" style={{ ["--cols" as string]: 3 }}>
                    <button className="r-cell" disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
                    <button className="r-cell" disabled={i === drivers.length - 1} onClick={() => move(i, 1)}>Down</button>
                    <button className="r-cell r-cell--red" onClick={() => setDrivers((l) => l.filter((x) => x !== u))}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ color: "var(--r-text-dim)" }}>{lineupLine(drivers.length, seats || 0)}</div>
      <div className="r-row">
        <div className="r-select r-fill">
          <select aria-label="Add a driver" value={add} onChange={(e) => setAdd(e.target.value)} disabled={!team}>
            <option value="">{team ? (free.length ? "Choose a driver" : "No driver left to add") : "Choose a team first"}</option>
            {free.map((r) => <option key={r.userId} value={r.userId}>{r.username}</option>)}
          </select>
        </div>
        <button className="r-btn" style={{ width: 160 }} disabled={!add} onClick={() => { setDrivers((l) => [...l, add]); setAdd(""); }}>Add driver</button>
      </div>
    </Dialog>
  );
}
