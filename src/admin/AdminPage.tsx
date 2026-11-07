import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { currentSession } from "../../shared/sessions";
import type { AdminRace, AdminTeam, AdminUser, Role, SessionSummary, SessionType, SystemInfo } from "../../shared/types";
import { admin, registrationApi } from "../api";
import type { RegSettings } from "../../shared/registration";
import { useMe } from "../me";
import { Topbar, VERSION } from "../Shell";
import { Dialog, toast } from "../ui";
import { NotFound } from "../NotFound";
import { AddMember, MemberTable } from "../TeamMembers";
import { RegistrationsTab } from "./RegistrationsTab";
import { CodeDialog, useTokenMode } from "../access";

type Tab = "users" | "races" | "registrations" | "teams" | "system";

const ERRORS: Record<string, string> = {
  invalid: "Invalid value. For teams, set a car (factory) or a factory team (customer).",
  invalid_username: "Enter a Roblox username (3-20 letters, numbers or underscores).",
  no_such_roblox_user: "No Roblox user with that name.",
  lookup_failed: "Could not reach Roblox. Try again in a moment.",
  last_admin: "There must be at least one admin.",
  forbidden: "Not allowed.",
  not_found: "Not found.",
  name_taken: "That name is already used.",
  invalid_times: "The end must be after the start.",
  has_principal: "This team already has a Team Principal.",
  invalid_roles: "Pick at least one role.",
  has_customers: "Customer teams still run this factory team's car.",
};
const say = (e: string) => toast(ERRORS[e] ?? "Request failed.");

/** Value for <input type="datetime-local"> in the browser's time zone. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).getTime() : NaN);
const inDays = (n: number) => toLocalInput(Date.now() + n * 86400_000);

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const ROLE_LABEL: Record<Role, string> = { admin: "Admin", users: "Users", races: "Races", steward: "Steward" };

export function AdminPage() {
  const { me } = useMe();
  const canUsers = !!me && (me.roles.includes("admin") || me.roles.includes("users"));
  const canRaces = !!me && (me.roles.includes("admin") || me.roles.includes("races"));
  const isAdmin = !!me?.roles.includes("admin");
  const tabs = ([canUsers && "users", canRaces && "races", canRaces && "registrations", canUsers && "teams", isAdmin && "system"].filter(Boolean) as Tab[]);
  const [tab, setTab] = useState<Tab | null>(null);
  const active = tab && tabs.includes(tab) ? tab : tabs[0];

  if (!me || !tabs.length) return <NotFound />;
  return (
    <div className="page">
      <Topbar>
        <div className="r-row" style={{ marginLeft: 12 }}>
          {tabs.map((t) => (
            <button key={t} className="r-btn" aria-pressed={active === t} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </Topbar>
      <div className="page__body">
        <div className="page__col page__col--wide">
          {active === "users" && <Users isAdmin={isAdmin} myId={me.id} />}
          {active === "races" && <Races />}
          {active === "registrations" && <Registrations />}
          {active === "teams" && <Teams />}
          {active === "system" && <System />}
        </div>
      </div>
      <div className="r-statusbar">
        <span className="r-statusbar__end">{VERSION}</span>
      </div>
    </div>
  );
}

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    load().then(setData, () => setFailed(true));
  }, [load]);
  useEffect(reload, [reload]);
  return { data, failed, reload, setData };
}

// ---- Users ------------------------------------------------------------------

function Users({ isAdmin, myId }: { isAdmin: boolean; myId: string }) {
  const { data, failed, reload, setData } = useLoad<AdminUser[]>(admin.users);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await admin.addUser(name.trim());
    setBusy(false);
    if (!r.ok) return say(r.error);
    setName("");
    toast("User added.", "green");
    reload();
  };
  const toggle = async (u: AdminUser, role: Role, on: boolean) => {
    const roles = on ? [...u.roles, role] : u.roles.filter((r) => r !== role);
    setData((d) => d && d.map((x) => (x.id === u.id ? { ...x, roles } : x)));
    const r = await admin.setRoles(u.id, roles);
    if (!r.ok) say(r.error);
    reload();
  };

  const rows = (data ?? []).filter((u) => !filter || u.username.toLowerCase().includes(filter.toLowerCase()) || u.displayName.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <div className="r-panel">
        <div className="r-header">Add user</div>
        <div className="r-row" style={{ padding: 4 }}>
          <input className="r-field r-fill" placeholder="Roblox username" aria-label="Roblox username" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="r-btn" style={{ width: 120 }} disabled={!name.trim() || busy} onClick={add}>Add</button>
        </div>
      </div>
      <div className="r-panel">
        <div className="r-header">Users</div>
        <div style={{ padding: 4 }}>
          <input className="r-field" style={{ width: "100%" }} placeholder="Filter" aria-label="Filter users" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {failed ? (
          <div className="r-empty">Could not load users.</div>
        ) : !data ? null : rows.length === 0 ? (
          <div className="r-empty">No users.</div>
        ) : (
          <table className="r-table">
            <thead>
              <tr>
                <th className="is-left">Username</th>
                <th className="is-left" style={{ width: 150 }}>Last sign-in</th>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <th key={r} style={{ width: 90 }}>{ROLE_LABEL[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="is-left">{u.username}{u.displayName !== u.username ? ` (${u.displayName})` : ""}</td>
                  <td className="is-left" style={{ color: "var(--r-text-dim)" }}>{u.lastLogin ? dateFmt.format(u.lastLogin) : ""}</td>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <td key={r}>
                      <label className="r-check" style={{ justifyContent: "flex-end" }}>
                        <input
                          type="checkbox"
                          aria-label={`${u.username} ${ROLE_LABEL[r]}`}
                          checked={u.roles.includes(r)}
                          disabled={r === "admin" && (!isAdmin || u.id === myId)}
                          onChange={(e) => toggle(u, r, e.target.checked)}
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Registrations() {
  const { data } = useLoad<AdminRace[]>(admin.races);
  return data ? <RegistrationsTab races={data} /> : null;
}

// ---- Races ------------------------------------------------------------------

type RaceDialog = { kind: "stewards" | "expiry" | "sessions"; raceId: string } | null;

function Races() {
  const nav = useNavigate();
  const { data, failed, reload } = useLoad<AdminRace[]>(admin.races);
  const [name, setName] = useState("");
  const [expires, setExpires] = useState(() => inDays(1));
  const [dialog, setDialog] = useState<RaceDialog>(null);
  const at = fromLocalInput(expires);
  const valid = !!name.trim() && at > Date.now();

  const create = async () => {
    if (!valid) return;
    const r = await admin.createRace(name.trim(), at);
    if (!r.ok) return say(r.error);
    setName("");
    toast("Race created.", "green");
    reload();
  };
  const setStatus = async (r: AdminRace, status: "active" | "archived") => {
    const res = await admin.patchRace(r.id, { status });
    if (!res.ok) say(res.error);
    reload();
  };
  const dialogRace = dialog ? data?.find((r) => r.id === dialog.raceId) : undefined;

  return (
    <>
      <div className="r-panel">
        <div className="r-header">New race</div>
        <div className="r-row" style={{ padding: 4 }}>
          <input className="r-field r-fill" placeholder="Name" aria-label="Race name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          <input className="r-field" style={{ width: 230, colorScheme: "dark" }} type="datetime-local" aria-label="Expires" value={expires} onChange={(e) => setExpires(e.target.value)} />
          <button className="r-btn" style={{ width: 120 }} disabled={!valid} onClick={create}>Create</button>
        </div>
      </div>
      <div className="r-panel">
        <div className="r-header">Races</div>
        {failed ? (
          <div className="r-empty">Could not load races.</div>
        ) : !data ? null : data.length === 0 ? (
          <div className="r-empty">No races.</div>
        ) : (
          <table className="r-table">
            <thead>
              <tr>
                <th className="is-left">Name</th>
                <th className="is-left" style={{ width: 90 }}>Status</th>
                <th className="is-left" style={{ width: 170 }}>Expires</th>
                <th style={{ width: 70 }}>Stewards</th>
                <th style={{ width: 450 }} />
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const expired = r.status === "active" && r.expiresAt <= Date.now();
                return (
                  <tr key={r.id}>
                    <td className="is-left">{r.name}</td>
                    <td className="is-left" style={{ color: r.status === "archived" ? "var(--r-text-dim)" : expired ? "var(--r-yellow)" : "var(--r-green)" }}>
                      {r.status === "archived" ? "Archived" : expired ? "Expired" : "Active"}
                    </td>
                    <td className="is-left">{dateFmt.format(r.expiresAt)}</td>
                    <td>{r.stewards.length || ""}</td>
                    <td style={{ padding: 2 }}>
                      <div className="r-grid" style={{ ["--cols" as string]: 5 }}>
                        <button
                          className="r-cell"
                          disabled={!r.sessions.length}
                          onClick={() => nav(`/session/${currentSession(r.sessions, Date.now())!.id}/steward`)}
                        >
                          Panel
                        </button>
                        <button className="r-cell" onClick={() => setDialog({ kind: "sessions", raceId: r.id })}>Sessions</button>
                        <button className="r-cell" onClick={() => setDialog({ kind: "stewards", raceId: r.id })}>Stewards</button>
                        <button className="r-cell" onClick={() => setDialog({ kind: "expiry", raceId: r.id })}>Expiry</button>
                        <button className="r-cell" onClick={() => setStatus(r, r.status === "archived" ? "active" : "archived")}>
                          {r.status === "archived" ? "Restore" : "Archive"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {dialog?.kind === "sessions" && dialogRace && <SessionsDialog race={dialogRace} onChange={reload} onClose={() => setDialog(null)} />}
      {dialog?.kind === "stewards" && dialogRace && <StewardsDialog race={dialogRace} onChange={reload} onClose={() => setDialog(null)} />}
      {dialog?.kind === "expiry" && dialogRace && <ExpiryDialog race={dialogRace} onDone={() => { setDialog(null); reload(); }} onClose={() => setDialog(null)} />}
    </>
  );
}

const TYPE_LABEL: Record<SessionType, string> = { practice: "Practice", timed: "Timed event", race: "Race" };

function SessionsDialog({ race, onChange, onClose }: { race: AdminRace; onChange: () => void; onClose: () => void }) {
  const [form, setForm] = useState<{ session?: SessionSummary } | null>(null);
  const [del, setDel] = useState<SessionSummary | null>(null);
  const [regFor, setRegFor] = useState<SessionSummary | null>(null);
  return (
    <>
      {regFor && <RegistrationDialog session={regFor} onClose={() => { setRegFor(null); onChange(); }} />}
      {!form && !del && !regFor && (
      <Dialog title={`Sessions: ${race.name}`} size="l" onClose={onClose} foot={<><button className="r-btn" onClick={() => setForm({})}>Add session</button><button className="r-btn" onClick={onClose}>Close</button></>}>
        {race.sessions.length === 0 ? (
          <div className="r-empty">No sessions.</div>
        ) : (
          <table className="r-table">
            <tbody>
              {race.sessions.map((s) => (
                <tr key={s.id}>
                  <td className="is-left" style={{ width: 130 }}>
                    <div>{s.name}</div>
                    {s.selfTimed ? (
                      <div style={{ color: "var(--r-text-dim)" }}>Self-timed</div>
                    ) : (
                      s.name !== TYPE_LABEL[s.type] && <div style={{ color: "var(--r-text-dim)" }}>{TYPE_LABEL[s.type]}</div>
                    )}
                  </td>
                  <td className="is-left">
                    <div>{dateFmt.format(s.startsAt)}</div>
                    <div style={{ color: "var(--r-text-dim)" }}>{dateFmt.format(s.endsAt)}</div>
                  </td>
                  <td style={{ width: 260, padding: 2 }}>
                    <div className="r-grid" style={{ ["--cols" as string]: 3 }}>
                      <button className="r-cell" onClick={() => setForm({ session: s })}>Edit</button>
                      <button className="r-cell" onClick={() => setRegFor(s)}>Registration</button>
                      <button className="r-cell r-cell--red" onClick={() => setDel(s)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Dialog>
      )}
      {form && <SessionForm race={race} session={form.session} onDone={() => { setForm(null); onChange(); }} onClose={() => setForm(null)} />}
      {del && (
        <Dialog
          title="Delete session"
          size="s"
          onClose={() => setDel(null)}
          foot={
            <>
              <button className="r-btn" onClick={() => setDel(null)}>Cancel</button>
              <button className="r-btn" onClick={async () => { await admin.deleteSession(del.id); setDel(null); onChange(); }}>Delete</button>
            </>
          }
        >
          <div>{del.name} is removed from the event.</div>
        </Dialog>
      )}
    </>
  );
}

function SessionForm({ race, session, onDone, onClose }: { race: AdminRace; session?: SessionSummary; onDone: () => void; onClose: () => void }) {
  const last = race.sessions[race.sessions.length - 1];
  const [type, setType] = useState<SessionType>(session?.type ?? "practice");
  const [name, setName] = useState(session?.name ?? "");
  const [start, setStart] = useState(() => toLocalInput(session?.startsAt ?? Math.max(Date.now(), last?.endsAt ?? 0)));
  const [selfTimed, setSelfTimed] = useState(session?.selfTimed ?? false);
  const [end, setEnd] = useState(() => toLocalInput(session?.endsAt ?? Math.max(Date.now(), last?.endsAt ?? 0) + 3600_000));
  const startsAt = fromLocalInput(start);
  const endsAt = fromLocalInput(end);
  const ok = Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt > startsAt;
  const save = async () => {
    if (!ok) return;
    const r = session
      ? await admin.patchSession(session.id, { name: name.trim() || session.name, type, startsAt, endsAt, selfTimed: type === "practice" && selfTimed })
      : await admin.createSession(race.id, { name: name.trim(), type, startsAt, endsAt, selfTimed: type === "practice" && selfTimed });
    if (!r.ok) return say(r.error);
    onDone();
  };
  return (
    <Dialog
      title={session ? "Edit session" : "Add session"}
      size="l"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn" disabled={!ok} onClick={save}>Save</button>
        </>
      }
    >
      <div className="r-form-field">
        <span className="r-label">Type</span>
        <div className="r-select">
          <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value as SessionType)}>
            <option value="practice">Practice</option>
            <option value="timed">Timed event</option>
            <option value="race">Race</option>
          </select>
        </div>
      </div>
      {type === "practice" && (
        <label className="r-check">
          <input type="checkbox" checked={selfTimed} onChange={(e) => setSelfTimed(e.target.checked)} />
          <span>Self-timed by teams</span>
        </label>
      )}
      <div className="r-form-field">
        <span className="r-label">Name</span>
        <input className="r-field" aria-label="Name" maxLength={60} placeholder={session ? session.name : "Automatic"} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="r-row">
        <div className="r-form-field r-fill">
          <span className="r-label">Start</span>
          <input className="r-field" style={{ colorScheme: "dark" }} type="datetime-local" aria-label="Start" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="r-form-field r-fill">
          <span className="r-label">End</span>
          <input className="r-field" style={{ colorScheme: "dark" }} type="datetime-local" aria-label="End" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}

function StewardsDialog({ race, onChange, onClose }: { race: AdminRace; onChange: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const add = async () => {
    if (!name.trim()) return;
    const r = await admin.addSteward(race.id, name.trim());
    if (!r.ok) return say(r.error);
    setName("");
    onChange();
  };
  return (
    <Dialog title={`Stewards: ${race.name}`} size="l" onClose={onClose} foot={<button className="r-btn" onClick={onClose}>Close</button>}>
      {race.stewards.length === 0 ? (
        <div className="r-empty">No race stewards.</div>
      ) : (
        <table className="r-table">
          <tbody>
            {race.stewards.map((s) => (
              <tr key={s.id}>
                <td className="is-left">{s.username}</td>
                <td style={{ width: 120, padding: 2 }}>
                  <button className="r-btn r-cell--red" style={{ width: "100%", height: 24, paddingTop: 2 }} onClick={async () => { await admin.removeSteward(race.id, s.id); onChange(); }}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="r-row">
        <input className="r-field r-fill" placeholder="Roblox username" aria-label="Steward username" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="r-btn" style={{ width: 100 }} disabled={!name.trim()} onClick={add}>Add</button>
      </div>
    </Dialog>
  );
}

function ExpiryDialog({ race, onDone, onClose }: { race: AdminRace; onDone: () => void; onClose: () => void }) {
  const [value, setValue] = useState(() => toLocalInput(race.expiresAt));
  const at = fromLocalInput(value);
  const ok = Number.isFinite(at);
  const save = async () => {
    if (!ok) return;
    const r = await admin.patchRace(race.id, { expiresAt: at });
    if (!r.ok) return say(r.error);
    onDone();
  };
  return (
    <Dialog
      title={`Expiry: ${race.name}`}
      size="s"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn" disabled={!ok} onClick={save}>Save</button>
        </>
      }
    >
      <div className="r-form-field">
        <span className="r-label">Expires</span>
        <input className="r-field" style={{ colorScheme: "dark" }} type="datetime-local" aria-label="Expires" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      </div>
    </Dialog>
  );
}

// ---- Teams (temporary) --------------------------------------------------------

interface TeamDraft {
  name: string;
  kind: "factory" | "customer";
  car: string;
  factoryId: string;
}
const emptyDraft: TeamDraft = { name: "", kind: "factory", car: "", factoryId: "" };
const draftOk = (d: TeamDraft) => !!d.name.trim() && (d.kind === "factory" ? !!d.car.trim() : !!d.factoryId);
const draftBody = (d: TeamDraft) => ({ name: d.name.trim(), kind: d.kind, car: d.kind === "factory" ? d.car.trim() : undefined, factoryId: d.kind === "customer" ? d.factoryId : undefined });

/** Factory team (own car) or customer team (a factory team's car). */
function TeamKindFields({ draft, setDraft, factories }: { draft: TeamDraft; setDraft: (d: TeamDraft) => void; factories: AdminTeam[] }) {
  return (
    <>
      <div className="r-grid" style={{ ["--cols" as string]: 2 }}>
        <button className="r-btn" aria-pressed={draft.kind === "factory"} onClick={() => setDraft({ ...draft, kind: "factory" })}>Factory team</button>
        <button className="r-btn" aria-pressed={draft.kind === "customer"} onClick={() => setDraft({ ...draft, kind: "customer" })}>Customer team</button>
      </div>
      {draft.kind === "factory" ? (
        <input className="r-field" placeholder="Car name" aria-label="Car name" maxLength={40} value={draft.car} onChange={(e) => setDraft({ ...draft, car: e.target.value })} />
      ) : (
        <div className="r-select">
          <select aria-label="Factory team" value={draft.factoryId} onChange={(e) => setDraft({ ...draft, factoryId: e.target.value })}>
            <option value="">Factory team</option>
            {factories.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

function Teams() {
  const { data, failed, reload } = useLoad<AdminTeam[]>(admin.teams);
  const [draft, setDraft] = useState<TeamDraft>(emptyDraft);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<AdminTeam | null>(null);
  const [del, setDel] = useState<AdminTeam | null>(null);
  const factories = (data ?? []).filter((t) => t.kind === "factory");
  const create = async () => {
    if (!draftOk(draft)) return;
    const r = await admin.createTeam(draftBody(draft));
    if (!r.ok) return say(r.error);
    setDraft(emptyDraft);
    reload();
  };
  const team = data?.find((t) => t.id === open);
  return (
    <>
      <div className="r-panel">
        <div className="r-header">New team</div>
        <div className="r-stack" style={{ padding: 4 }}>
          <input className="r-field" placeholder="Name" aria-label="Team name" maxLength={40} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <TeamKindFields draft={draft} setDraft={setDraft} factories={factories} />
          <button className="r-btn" disabled={!draftOk(draft)} onClick={create}>Create</button>
        </div>
      </div>
      <div className="r-panel">
        <div className="r-header">Teams</div>
        {failed ? (
          <div className="r-empty">Could not load teams.</div>
        ) : !data ? null : data.length === 0 ? (
          <div className="r-empty">No teams.</div>
        ) : (
          <table className="r-table">
            <thead>
              <tr>
                <th className="is-left">Name</th>
                <th className="is-left" style={{ width: 110 }}>Type</th>
                <th className="is-left" style={{ width: 160 }}>Car or factory</th>
                <th style={{ width: 80 }}>Members</th>
                <th style={{ width: 300 }} />
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td className="is-left">{t.name}</td>
                  <td className="is-left" style={{ color: "var(--r-text-dim)" }}>{t.kind === "factory" ? "Factory" : "Customer"}</td>
                  <td className="is-left">{t.kind === "factory" ? t.car ?? "" : t.factoryName ?? ""}</td>
                  <td>{t.members.length || ""}</td>
                  <td style={{ padding: 2 }}>
                    <div className="r-grid" style={{ ["--cols" as string]: 3 }}>
                      <button className="r-cell" onClick={() => setEdit(t)}>Edit</button>
                      <button className="r-cell" onClick={() => setOpen(t.id)}>Members</button>
                      <button className="r-cell r-cell--red" onClick={() => setDel(t)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && (
        <EditTeamDialog
          team={edit}
          factories={factories.filter((f) => f.id !== edit.id)}
          onDone={() => {
            setEdit(null);
            reload();
          }}
          onClose={() => setEdit(null)}
        />
      )}
      {team && <MembersDialog team={team} onChange={reload} onClose={() => setOpen(null)} />}
      {del && (
        <Dialog
          title="Delete team"
          size="s"
          onClose={() => setDel(null)}
          foot={
            <>
              <button className="r-btn" onClick={() => setDel(null)}>Cancel</button>
              <button
                className="r-btn"
                onClick={async () => {
                  await admin.deleteTeam(del.id);
                  setDel(null);
                  reload();
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <div>{del.name} and its panel access are removed. Drivers already staged keep the team name.</div>
        </Dialog>
      )}
    </>
  );
}

function EditTeamDialog({ team, factories, onDone, onClose }: { team: AdminTeam; factories: AdminTeam[]; onDone: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState<TeamDraft>({ name: team.name, kind: team.kind, car: team.car ?? "", factoryId: team.factoryId ?? "" });
  const save = async () => {
    const r = await admin.patchTeam(team.id, draftBody(draft));
    if (!r.ok) return say(r.error);
    onDone();
  };
  return (
    <Dialog
      title={`Edit team: ${team.name}`}
      size="l"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn" disabled={!draftOk(draft)} onClick={save}>Save</button>
        </>
      }
    >
      <input className="r-field" aria-label="Team name" maxLength={40} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <TeamKindFields draft={draft} setDraft={setDraft} factories={factories} />
    </Dialog>
  );
}

function MembersDialog({ team, onChange, onClose }: { team: AdminTeam; onChange: () => void; onClose: () => void }) {
  const tokens = useTokenMode();
  const [codeFor, setCodeFor] = useState<{ id: string; username: string } | null>(null);
  return (
    <>
      {codeFor && <CodeDialog name={codeFor.username} issue={() => admin.userCode(codeFor.id)} revoke={() => admin.revokeUserCode(codeFor.id)} onClose={() => setCodeFor(null)} />}
      {!codeFor && (
    <Dialog title={`Team members: ${team.name}`} size="l" onClose={onClose} foot={<button className="r-btn" onClick={onClose}>Close</button>}>
      <MemberTable
        members={team.members}
        canEdit
        canSetPrincipal
        compact
        onCode={tokens ? setCodeFor : undefined}
        onRoles={async (m, roles) => {
          const r = await admin.setMemberRoles(team.id, m.id, roles);
          if (!r.ok) say(r.error);
          onChange();
        }}
        onRemove={async (m) => {
          await admin.removeMember(team.id, m.id);
          onChange();
        }}
      />
      <AddMember
        canSetPrincipal
        onAdd={async (username, roles) => {
          const r = await admin.addMember(team.id, username, roles);
          if (!r.ok) {
            say(r.error);
            return false;
          }
          onChange();
          return true;
        }}
      />
    </Dialog>
      )}
    </>
  );
}

// ---- System -----------------------------------------------------------------

function System() {
  const { data, failed, reload } = useLoad<SystemInfo>(admin.system);
  const rows: [string, string][] = data
    ? [
        ["Users", String(data.users)],
        ["Admins", String(data.admins)],
        ["Active races", String(data.activeRaces)],
        ["Expired races", String(data.expiredRaces)],
        ["Archived races", String(data.archivedRaces)],
        ["Roblox sign-in", data.robloxConfigured ? "Configured" : "Missing secrets"],
        ["Version", VERSION],
      ]
    : [];
  return (
    <div className="r-panel">
      <div className="r-header">System</div>
      {failed ? (
        <div className="r-empty">Could not load system status.</div>
      ) : (
        <table className="r-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="is-left" style={{ width: 200 }}>{k}</td>
                <td className="is-left" style={{ color: v === "Missing secrets" ? "var(--r-red)" : undefined }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && (
        <label className="r-check" style={{ padding: 4 }}>
          <input
            type="checkbox"
            checked={data.tokenMode}
            onChange={async (e) => {
              const r = await admin.setTokenMode(e.target.checked);
              if (!r.ok) say(r.error);
              reload();
            }}
          />
          <span>Access token sign-in (everything except this admin panel)</span>
        </label>
      )}
    </div>
  );
}

function RegistrationDialog({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [on, setOn] = useState(false);
  const [opens, setOpens] = useState(inDays(0));
  const [deadline, setDeadline] = useState(toLocalInput(session.startsAt));
  const [n, setN] = useState({ drivers: "20", employees: "10", spectators: "10", factoryReserved: "1" });
  const [independents, setIndependents] = useState(false);
  const [staging, setStaging] = useState(session.staging);
  useEffect(() => {
    registrationApi.get(session.id).then(({ settings: s }) => {
      if (s) {
        setOn(true);
        setOpens(toLocalInput(s.opensAt));
        setDeadline(toLocalInput(s.deadline));
        setN({ drivers: String(s.drivers), employees: String(s.employees), spectators: String(s.spectators), factoryReserved: String(s.factoryReserved) });
        setIndependents(s.independents);
      }
      setLoaded(true);
    }, () => setLoaded(true));
  }, [session.id]);
  const num = (v: string) => (/^\d{1,3}$/.test(v) ? Number(v) : NaN);
  const settings: RegSettings = {
    opensAt: fromLocalInput(opens),
    deadline: fromLocalInput(deadline),
    drivers: num(n.drivers),
    employees: num(n.employees),
    spectators: num(n.spectators),
    factoryReserved: num(n.factoryReserved),
    independents,
  };
  const valid = [settings.opensAt, settings.deadline, settings.drivers, settings.employees, settings.spectators, settings.factoryReserved].every(Number.isFinite) && settings.deadline > settings.opensAt;
  const save = async () => {
    const r = on ? await admin.setRegistration(session.id, settings) : await admin.clearRegistration(session.id);
    if (!r.ok) return say(r.error);
    if (staging !== session.staging) {
      const p = await admin.patchSession(session.id, { staging });
      if (!p.ok) return say(p.error);
    }
    onClose();
  };
  const field = (label: string, key: keyof typeof n) => (
    <label className="r-row" style={{ alignItems: "center" }}>
      <span style={{ width: 240, flex: "none" }}>{label}</span>
      <input className="r-field r-fill" inputMode="numeric" aria-label={label} value={n[key]} onChange={(e) => setN({ ...n, [key]: e.target.value })} />
    </label>
  );
  return (
    <Dialog
      title={`Registration: ${session.name}`}
      size="l"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn" disabled={!loaded || (on && !valid)} onClick={save}>Save</button>
        </>
      }
    >
      <label className="r-check">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>Registration open for this session</span>
      </label>
      {on && (
        <>
          <label className="r-row" style={{ alignItems: "center" }}>
            <span style={{ width: 240, flex: "none" }}>Opens</span>
            <input className="r-field r-fill" type="datetime-local" aria-label="Registration opens" value={opens} onChange={(e) => setOpens(e.target.value)} />
          </label>
          <label className="r-row" style={{ alignItems: "center" }}>
            <span style={{ width: 240, flex: "none" }}>Deadline</span>
            <input className="r-field r-fill" type="datetime-local" aria-label="Registration deadline" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          {field("Driver spots", "drivers")}
          {field("Reserved per factory team", "factoryReserved")}
          {field("Employee spots", "employees")}
          {field("Spectator spots", "spectators")}
          <label className="r-check">
            <input type="checkbox" checked={independents} onChange={(e) => setIndependents(e.target.checked)} />
            <span>Independent drivers can register</span>
          </label>
        </>
      )}
      <label className="r-check">
        <input type="checkbox" checked={staging} onChange={(e) => setStaging(e.target.checked)} />
        <span>Allow staging without registration (stewards stage drivers by hand)</span>
      </label>
      {!on && <div style={{ color: "var(--r-text-dim)" }}>Saving with this off removes registration and every entry for this session.</div>}
    </Dialog>
  );
}
