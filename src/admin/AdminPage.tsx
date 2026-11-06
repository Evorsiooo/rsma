import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AdminRace, AdminUser, Role, SystemInfo } from "../../shared/types";
import { admin } from "../api";
import { useMe } from "../me";
import { Topbar, VERSION } from "../Shell";
import { Dialog, toast } from "../ui";
import { NotFound } from "../NotFound";

type Tab = "users" | "races" | "system";

const ERRORS: Record<string, string> = {
  invalid: "Invalid value.",
  invalid_username: "Enter a Roblox username (3-20 letters, numbers or underscores).",
  no_such_roblox_user: "No Roblox user with that name.",
  last_admin: "There must be at least one admin.",
  forbidden: "Not allowed.",
  not_found: "Not found.",
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
  const tabs = ([canUsers && "users", canRaces && "races", isAdmin && "system"].filter(Boolean) as Tab[]);
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

// ---- Races ------------------------------------------------------------------

type RaceDialog = { kind: "stewards" | "expiry"; raceId: string } | null;

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
                <th style={{ width: 360 }} />
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
                      <div className="r-grid" style={{ ["--cols" as string]: 4 }}>
                        <button className="r-cell" onClick={() => nav(`/race/${r.id}/steward`)}>Panel</button>
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
      {dialog?.kind === "stewards" && dialogRace && <StewardsDialog race={dialogRace} onChange={reload} onClose={() => setDialog(null)} />}
      {dialog?.kind === "expiry" && dialogRace && <ExpiryDialog race={dialogRace} onDone={() => { setDialog(null); reload(); }} onClose={() => setDialog(null)} />}
    </>
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

// ---- System -----------------------------------------------------------------

function System() {
  const { data, failed } = useLoad<SystemInfo>(admin.system);
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
    </div>
  );
}
