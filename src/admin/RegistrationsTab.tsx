import { useCallback, useEffect, useState } from "react";
import { inGroup, REG_KIND_LABEL, REG_KINDS, type GroupStatus, type RegKind, type Registration, type RegistrationView } from "../../shared/registration";
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
};
const clip = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const say = (e: string) => toast(ERRORS[e] ?? "Request failed.");

const dim = { color: "var(--r-text-dim)" } as const;
const CUT_LABEL = { in: "In", waitlist: "Waiting", denied: "Denied" } as const;

type Res = { ok: true } | { ok: false; error: string };

/** Staff review: everyone registered for one session, with deny, edit, remove and manual add. */
export function RegistrationsTab({ races }: { races: AdminRace[] }) {
  const [regIds, setRegIds] = useState<Set<string> | null>(null);
  const [sid, setSid] = useState("");
  const [view, setView] = useState<RegistrationView | null>(null);
  useEffect(() => {
    registrationApi.list().then((l) => setRegIds(new Set(l.map((r) => r.sessionId))), () => setRegIds(new Set()));
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
                  <td className="is-left">{REG_KIND_LABEL[k]}s</td>
                  <td style={{ width: 160 }}>{view.counts[k].taken} / {view.counts[k].spots}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
              <th className="is-left" style={{ width: 80 }}>Type</th>
              <th className="is-left" style={{ width: 140 }}>Team</th>
              <th className="is-left" style={{ width: 120 }}>Discord</th>
              <th style={{ width: 100 }}>Group</th>
              <th style={{ width: 70 }}>Status</th>
              <th style={{ width: tokens ? 320 : 240 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <td className="is-left" style={clip}>{r.username}</td>
                <td className="is-left" style={clip}>{REG_KIND_LABEL[r.kind]}</td>
                <td className="is-left" style={clip}>{r.teamName ?? "Independent"}</td>
                <td className="is-left" style={{ ...dim, ...clip }}>{r.discord ?? ""}</td>
                <td>{r.kind === "driver" ? (inGroup(r.group) ? "In group" : "Not in group") : ""}</td>
                <td>{CUT_LABEL[r.cut]}</td>
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
        <button className="r-btn" style={{ width: 160 }} onClick={() => setAdding(true)}>Add person</button>
      </div>
      {codeFor && <CodeDialog name={codeFor.username} issue={() => registrationApi.staffCode(sid, codeFor.userId)} onClose={() => setCodeFor(null)} />}
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
      <label className="r-check">
        <input type="checkbox" checked={inGroup(v.group)} onChange={(e) => setV({ ...v, group: e.target.checked ? "pending" : "unverified" })} />
        <span>Joined the RSMA Roblox group or request pending</span>
      </label>
      <input className="r-field" placeholder="Discord username" aria-label="Discord username" value={v.discord} onChange={(e) => setV({ ...v, discord: e.target.value })} />
    </Dialog>
  );
}
