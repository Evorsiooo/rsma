import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  GROUP_LABEL,
  GROUP_URL,
  GROUP_STATUSES,
  REG_KIND_LABEL,
  REG_KINDS,
  type GroupStatus,
  type RegKind,
  type Registration,
  type RegistrationView,
  type RegTeam,
} from "../shared/registration";
import { PANEL_ROLES, hasAny } from "../shared/teams";
import type { SessionInfo } from "../shared/types";
import { api, registrationApi } from "./api";
import { useMe } from "./me";
import { NotFound } from "./NotFound";
import { Shell } from "./Shell";
import { Dialog, toast } from "./ui";

const ERRORS: Record<string, string> = {
  not_open: "Registration is not open.",
  taken: "Already registered, by another team or as an independent.",
  not_member: "That person is not in this team.",
  wrong_role: "Drivers need the Driver role, employees a staff role.",
  no_such_roblox_user: "No Roblox user with that name.",
  invalid: "Invalid value.",
  invalid_discord: "Enter your Discord username.",
  group_required: "Say whether you joined the group or your request is pending.",
  independents_closed: "Independent drivers cannot register for this session.",
  forbidden: "Not allowed.",
};
const say = (e: string) => toast(ERRORS[e] ?? "Request failed.");

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dim = { color: "var(--r-text-dim)" } as const;
const small = { width: "100%", height: 24, paddingTop: 2 } as const;
const CUT_LABEL = { in: "In", waitlist: "Waiting", denied: "Denied" } as const;

type Res = { ok: true } | { ok: false; error: string };

export function RegistrationPage() {
  const { id = "" } = useParams();
  const { me } = useMe();
  const [info, setInfo] = useState<SessionInfo | null | undefined>(undefined);
  const [view, setView] = useState<RegistrationView | null>(null);
  const load = useCallback(() => registrationApi.get(id).then(setView, () => {}), [id]);
  useEffect(() => {
    api.session(id).then(setInfo, () => setInfo(null));
    load();
  }, [id, load]);
  const act = async (p: Promise<Res>) => {
    const r = await p;
    if (!r.ok) say(r.error);
    await load();
    return r.ok;
  };

  if (info === null || (view && !view.settings)) return <NotFound />;
  if (!info || !view?.settings) return <Shell wide><div className="r-panel" /></Shell>;
  const s = view.settings;
  const open = view.phase === "open";
  const label = view.phase === "upcoming" ? `Opens ${fmt.format(s.opensAt)}` : open ? `Open until ${fmt.format(s.deadline)}` : "Closed";

  return (
    <Shell wide>
      <div className="r-row">
        <div className={`r-banner r-fill${open ? " is-green" : ""}`}>
          {info.session.name} registration · {label}
        </div>
      </div>
      <div className="r-panel">
        <div className="r-header">Spots</div>
        <table className="r-table">
          <tbody>
            {REG_KINDS.map((k) => (
              <tr key={k}>
                <td className="is-left">{REG_KIND_LABEL[k]}s</td>
                <td style={{ width: 160 }}>{view.counts[k].taken} / {view.counts[k].spots}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.teams.map((t) => (
        <TeamSection key={t.id} team={t} view={view} open={open} sid={id} act={act} />
      ))}
      <Own view={view} open={open} sid={id} signedIn={!!me} act={act} />
      {view.staff && <StaffSection view={view} sid={id} act={act} />}
    </Shell>
  );
}

function groupText(g: GroupStatus) {
  return GROUP_LABEL[g];
}

function TeamSection({ team, view, open, sid, act }: { team: RegTeam; view: RegistrationView; open: boolean; sid: string; act: (p: Promise<Res>) => Promise<boolean> }) {
  const mine = view.registrations.filter((r) => r.teamId === team.id);
  const [kind, setKind] = useState<RegKind>("driver");
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const free = team.members.filter((m) => !mine.some((r) => r.userId === m.id) && (kind === "driver" ? m.roles.includes("driver") : hasAny(m.roles, PANEL_ROLES)));
  const username = kind === "spectator" ? name.trim() : pick || free[0]?.username || "";
  const hasDriver = mine.some((r) => r.kind === "driver");
  return (
    <div className="r-panel">
      <div className="r-header">{team.name}</div>
      {hasDriver && (
        <div className="r-banner is-teal">
          Ask your drivers to <a href={GROUP_URL} target="_blank" rel="noreferrer">join the RSMA Roblox group</a> (pending or joined) before the deadline, or they cannot race.
        </div>
      )}
      {mine.length === 0 ? (
        <div className="r-empty">Nobody registered.</div>
      ) : (
        <table className="r-table">
          <tbody>
            {mine.map((r) => (
              <tr key={r.userId}>
                <td className="is-left">{r.username}</td>
                <td style={{ width: 110, ...dim }}>{REG_KIND_LABEL[r.kind]}</td>
                <td style={{ width: 130, ...dim }}>{r.kind === "driver" ? groupText(r.group) : ""}</td>
                <td style={{ width: 90 }}>{CUT_LABEL[r.cut]}</td>
                {open && (
                  <td style={{ width: 100, padding: 2 }}>
                    <button className="r-btn r-cell--red" style={small} onClick={() => act(registrationApi.teamRemove(sid, team.id, r.userId))}>Remove</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <div className="r-row" style={{ padding: 4 }}>
          <div className="r-select" style={{ width: 160, flex: "none" }}>
            <select aria-label="Kind" value={kind} onChange={(e) => { setKind(e.target.value as RegKind); setPick(""); }}>
              {REG_KINDS.map((k) => <option key={k} value={k}>{REG_KIND_LABEL[k]}</option>)}
            </select>
          </div>
          {kind === "spectator" ? (
            <input className="r-field r-fill" placeholder="Roblox username" aria-label="Spectator username" value={name} onChange={(e) => setName(e.target.value)} />
          ) : (
            <div className="r-select r-fill">
              <select aria-label="Person" value={pick || free[0]?.username || ""} onChange={(e) => setPick(e.target.value)}>
                {free.map((m) => <option key={m.id} value={m.username}>{m.username}</option>)}
              </select>
            </div>
          )}
          <button
            className="r-btn"
            style={{ width: 100 }}
            disabled={!username}
            onClick={async () => {
              if (await act(registrationApi.teamAdd(sid, team.id, username, kind))) { setName(""); setPick(""); }
            }}
          >
            Register
          </button>
        </div>
      )}
    </div>
  );
}

function Own({ view, open, sid, signedIn, act }: { view: RegistrationView; open: boolean; sid: string; signedIn: boolean; act: (p: Promise<Res>) => Promise<boolean> }) {
  const [discord, setDiscord] = useState("");
  const [group, setGroup] = useState<"joined" | "pending" | null>(null);
  const self = view.self;
  const s = view.settings!;
  if (self) {
    return (
      <div className="r-panel">
        <div className="r-header">Your registration</div>
        <table className="r-table">
          <tbody>
            <tr>
              <td className="is-left">{REG_KIND_LABEL[self.kind]}{self.teamName ? ` · ${self.teamName}` : " · Independent"}</td>
              <td style={{ width: 90 }}>{CUT_LABEL[self.cut]}</td>
            </tr>
          </tbody>
        </table>
        {self.kind === "driver" && (
          <div className="r-row" style={{ padding: 4, alignItems: "center" }}>
            <span className="r-fill">
              <a href={GROUP_URL} target="_blank" rel="noreferrer">RSMA Roblox group</a>: {groupText(self.group)}
            </span>
            {open && GROUP_STATUSES.filter((g) => g !== "unverified").map((g) => (
              <button key={g} className="r-btn" style={{ width: 120 }} aria-pressed={self.group === g} onClick={() => act(registrationApi.selfGroup(sid, g))}>
                {GROUP_LABEL[g]}
              </button>
            ))}
            {open && !self.teamId && (
              <button className="r-btn r-cell--red" style={{ width: 120 }} onClick={() => act(registrationApi.withdraw(sid))}>Withdraw</button>
            )}
          </div>
        )}
      </div>
    );
  }
  if (!s.independents || !open) return null;
  if (!signedIn) {
    return (
      <div className="r-row">
        <button className="r-btn" style={{ width: 260 }} onClick={() => location.assign(`/api/auth/roblox/login?next=/session/${sid}/register`)}>
          Sign in to register as independent
        </button>
      </div>
    );
  }
  return (
    <div className="r-panel">
      <div className="r-header">Register as an independent driver</div>
      <div style={{ padding: 4, display: "grid", gap: 4 }}>
        <input className="r-field" placeholder="Discord username" aria-label="Discord username" maxLength={32} value={discord} onChange={(e) => setDiscord(e.target.value)} />
        <div className="r-row" style={{ alignItems: "center" }}>
          <span className="r-fill">
            <a href={GROUP_URL} target="_blank" rel="noreferrer">RSMA Roblox group</a>
          </span>
          <button className="r-btn" style={{ width: 160 }} aria-pressed={group === "joined"} onClick={() => setGroup("joined")}>Joined</button>
          <button className="r-btn" style={{ width: 160 }} aria-pressed={group === "pending"} onClick={() => setGroup("pending")}>Request pending</button>
        </div>
        <button className="r-btn" disabled={!discord.trim() || !group} onClick={() => act(registrationApi.independent(sid, discord.trim(), group!))}>
          Register
        </button>
      </div>
    </div>
  );
}

function StaffSection({ view, sid, act }: { view: RegistrationView; sid: string; act: (p: Promise<Res>) => Promise<boolean> }) {
  const [edit, setEdit] = useState<Registration | null>(null);
  const [adding, setAdding] = useState(false);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api.teams().then(setTeams, () => {});
  }, []);
  const order = { in: 0, waitlist: 1, denied: 2 } as const;
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
              <th className="is-left" style={{ width: 100 }}>Type</th>
              <th className="is-left" style={{ width: 170 }}>Team</th>
              <th className="is-left" style={{ width: 150 }}>Discord</th>
              <th style={{ width: 120 }}>Group</th>
              <th style={{ width: 90 }}>Status</th>
              <th style={{ width: 240 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <td className="is-left">{r.username}</td>
                <td className="is-left">{REG_KIND_LABEL[r.kind]}</td>
                <td className="is-left">{r.teamName ?? "Independent"}</td>
                <td className="is-left" style={dim}>{r.discord ?? ""}</td>
                <td style={r.kind === "driver" ? undefined : dim}>{r.kind === "driver" ? groupText(r.group) : ""}</td>
                <td>{CUT_LABEL[r.cut]}</td>
                <td style={{ padding: 2 }}>
                  <div className="r-grid" style={{ ["--cols" as string]: 3 }}>
                    <button className="r-cell" onClick={() => act(registrationApi.staffEdit(sid, r.userId, { denied: !r.denied }))}>{r.denied ? "Restore" : "Deny"}</button>
                    <button className="r-cell" onClick={() => setEdit(r)}>Edit</button>
                    <button className="r-cell r-cell--red" onClick={() => act(registrationApi.staffRemove(sid, r.userId))}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ padding: 4 }}>
        <button className="r-btn" style={{ width: 160 }} onClick={() => setAdding(true)}>Add person</button>
      </div>
      {adding && <PersonDialog title="Add person" teams={teams} onClose={() => setAdding(false)} onSave={async (v) => act(registrationApi.staffAdd(sid, { username: v.username!, kind: v.kind, teamId: v.teamId, discord: v.discord || undefined, group: v.group }))} />}
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
      <div className="r-select">
        <select aria-label="Group" value={v.group} onChange={(e) => setV({ ...v, group: e.target.value as GroupStatus })}>
          {GROUP_STATUSES.map((g) => <option key={g} value={g}>{`Roblox group: ${GROUP_LABEL[g]}`}</option>)}
        </select>
      </div>
      <input className="r-field" placeholder="Discord username" aria-label="Discord username" value={v.discord} onChange={(e) => setV({ ...v, discord: e.target.value })} />
    </Dialog>
  );
}
