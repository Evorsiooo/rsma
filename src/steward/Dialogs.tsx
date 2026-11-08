import { useState } from "react";
import { fmtPenalty, fmtTime, type DriverNote, type RaceState, type Run } from "../../shared/race";
import type { Team } from "../../shared/types";
import { Dialog } from "../ui";

type Send = (cmd: import("../../shared/commands").Command) => Promise<boolean>;

export function ConfirmReset({ onClose, send }: { onClose: () => void; send: Send }) {
  const [text, setText] = useState("");
  const ok = text === "RESET";
  const submit = async () => {
    if (ok && (await send({ type: "reset" }))) onClose();
  };
  return (
    <Dialog
      title="Reset stage"
      size="s"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn" disabled={!ok} onClick={submit}>Reset</button>
        </>
      }
    >
      <div>This clears all times, penalties and radio history. Drivers still in the queue stay.</div>
      <div className="r-form-field">
        <span className="r-label is-req">Type RESET to confirm</span>
        <input
          className={`r-field${text && !ok ? " is-invalid" : ""}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          aria-label="Type RESET to confirm"
        />
      </div>
    </Dialog>
  );
}

const carId = (r: { plate: string; number?: string }) => [r.number ? `#${r.number}` : "", r.plate].filter(Boolean).join(" ");

export function ConfirmDelete({ run, onClose, send }: { run: Run; onClose: () => void; send: Send }) {
  return (
    <Dialog
      title={`Delete run: ${run.name}`}
      size="s"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button
            className="r-btn"
            onClick={async () => {
              if (await send({ type: "delRun", runId: run.id })) onClose();
            }}
          >
            Delete
          </button>
        </>
      }
    >
      <div>Delete the run of {run.name} ({carId(run) || "unassigned"})? It is removed from the results.</div>
    </Dialog>
  );
}

export function ConfirmDnf({ run, onClose, send }: { run: Run; onClose: () => void; send: Send }) {
  return (
    <Dialog
      title={`DNF: ${run.name}`}
      size="s"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button
            className="r-btn"
            onClick={async () => {
              if (await send({ type: "dnf", runId: run.id })) onClose();
            }}
          >
            DNF
          </button>
        </>
      }
    >
      <div>Mark {run.name} as did not finish? This cannot be undone.</div>
    </Dialog>
  );
}

export function PenaltyDialog({ run, state, onClose, send }: { run: Run; state: RaceState; onClose: () => void; send: Send }) {
  const count = (ruleId: string) => run.penalties.filter((p) => p.ruleId === ruleId).length;
  // Penalties whose rule was deleted later stay on the run and can still be removed.
  const orphans = [...new Map(run.penalties.filter((p) => !state.rules.some((r) => r.id === p.ruleId)).map((p) => [p.ruleId, p])).values()];
  const row = (ruleId: string, name: string, ms: number | null) => (
    <tr key={ruleId}>
      <td className="is-left">{name}</td>
      <td style={{ width: 90, color: "var(--r-text-dim)" }}>{ms == null ? "" : fmtPenalty(ms)}</td>
      <td style={{ width: 130 }}>
        <div className="r-stepper" style={{ justifyContent: "flex-end" }}>
          <button className="r-cell" style={{ height: 19 }} aria-label={`Remove ${name}`} disabled={count(ruleId) === 0}
            onClick={() => send({ type: "penalty", runId: run.id, ruleId, delta: -1 })}>-</button>
          <div className={`r-readout${count(ruleId) ? " is-red" : ""}`} style={{ height: 19, minWidth: 36, padding: "2px 6px 0" }}>{count(ruleId)}</div>
          <button className="r-cell" style={{ height: 19 }} aria-label={`Add ${name}`} disabled={ms == null}
            onClick={() => send({ type: "penalty", runId: run.id, ruleId, delta: 1 })}>+</button>
        </div>
      </td>
    </tr>
  );
  return (
    <Dialog title={`Penalties: ${run.name}`} size="l" onClose={onClose} foot={<button className="r-btn" onClick={onClose}>Close</button>}>
      <table className="r-table">
        <tbody>
          {state.rules.map((r) => row(r.id, r.name, r.seconds * 1000))}
          {orphans.map((p) => row(p.ruleId, p.name, null))}
        </tbody>
      </table>
      <div className="r-row" style={{ justifyContent: "space-between" }}>
        <span className="r-label">Total</span>
        <span className={run.penaltyMs ? "is-red" : ""}>{run.penaltyMs ? fmtPenalty(run.penaltyMs) : "0.000"}</span>
      </div>
    </Dialog>
  );
}

export function RulesDialog({ state, onClose, send }: { state: RaceState; onClose: () => void; send: Send }) {
  const [name, setName] = useState("");
  const [secs, setSecs] = useState("5");
  const valid = name.trim() !== "" && /^\d+$/.test(secs) && Number(secs) <= 600;
  const add = async () => {
    if (valid && (await send({ type: "ruleAdd", name, seconds: Number(secs) }))) {
      setName("");
      setSecs("5");
    }
  };
  return (
    <Dialog title="Penalty rules" onClose={onClose} foot={<button className="r-btn" onClick={onClose}>Close</button>}>
      <table className="r-table">
        <thead>
          <tr>
            <th className="is-left">Rule</th>
            <th style={{ width: 90 }}>Seconds</th>
            <th style={{ width: 90 }} />
          </tr>
        </thead>
        <tbody>
          {state.rules.map((r) => (
            <tr key={r.id}>
              <td className="is-left">{r.name}</td>
              <td>
                <SecondsField value={r.seconds} onCommit={(n) => send({ type: "ruleSet", id: r.id, seconds: n })} label={`Seconds for ${r.name}`} />
              </td>
              <td>
                <button className="r-cell r-cell--red" style={{ height: 19 }} onClick={() => send({ type: "ruleDel", id: r.id })}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="r-row" style={{ alignItems: "flex-end" }}>
        <div className="r-form-field r-fill">
          <span className="r-label">New rule</span>
          <input className="r-field" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="New rule name" />
        </div>
        <div className="r-form-field" style={{ width: 70 }}>
          <span className="r-label">Seconds</span>
          <input className="r-field" value={secs} onChange={(e) => setSecs(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="New rule seconds" />
        </div>
        <button className="r-btn" style={{ width: 80 }} disabled={!valid} onClick={add}>Add</button>
      </div>
    </Dialog>
  );
}

function SecondsField({ value, onCommit, label }: { value: number; onCommit: (n: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(String(value));
  }
  const commit = () => {
    if (/^\d+$/.test(text) && Number(text) <= 600) {
      if (Number(text) !== value) onCommit(Number(text));
    } else setText(String(value));
  };
  return (
    <input className="r-field" style={{ height: 19, textAlign: "right" }} value={text} aria-label={label}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
  );
}

export function RecipientsDialog({ runs, selected, onClose, onConfirm }: { runs: Run[]; selected: string[]; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const [ids, setIds] = useState(selected);
  const toggle = (id: string) => setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  return (
    <Dialog
      title="Recipients"
      size="s"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn" disabled={ids.length === 0} onClick={() => onConfirm(ids)}>Confirm</button>
        </>
      }
    >
      {runs.length === 0 && <div className="r-text--dim">No drivers.</div>}
      {runs.map((r) => (
        <label className="r-check" key={r.id}>
          <input type="checkbox" checked={ids.includes(r.id)} onChange={() => toggle(r.id)} />
          {r.name}
        </label>
      ))}
    </Dialog>
  );
}

export function AssignDialog({ ts, cars, onClose, send }: { ts: number; cars: Run[]; onClose: () => void; send: Send }) {
  const [id, setId] = useState(cars[0]?.id ?? "");
  const time = new Date(ts).toLocaleTimeString("en-GB");
  return (
    <Dialog
      title={`Pending finish ${time}`}
      size="s"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button
            className="r-btn"
            disabled={!id}
            onClick={async () => {
              if (await send({ type: "assign", ts, runId: id })) onClose();
            }}
          >
            Assign
          </button>
        </>
      }
    >
      {cars.length === 0 ? (
        <div className="r-text--dim">No car was running at that time.</div>
      ) : (
        <div className="r-form-field">
          <span className="r-label">Car</span>
          <div className="r-select">
            <select value={id} onChange={(e) => setId(e.target.value)} aria-label="Car">
              {cars.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({carId(c) || "unassigned"})</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function TeamsDialog({ teams, selected, onClose, onConfirm }: { teams: Team[]; selected: string[]; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const [ids, setIds] = useState(selected);
  const toggle = (id: string) => setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  return (
    <Dialog
      title="Teams"
      size="s"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn" disabled={ids.length === 0} onClick={() => onConfirm(ids)}>Confirm</button>
        </>
      }
    >
      {teams.length === 0 && <div className="r-text--dim">No teams.</div>}
      {teams.map((t) => (
        <label className="r-check" key={t.id}>
          <input type="checkbox" checked={ids.includes(t.id)} onChange={() => toggle(t.id)} />
          {t.name}
        </label>
      ))}
    </Dialog>
  );
}

const noteTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function NotesDialog({ run, notes, onClose, send, team }: { run: Run; notes: DriverNote[]; onClose: () => void; send: Send; team?: string }) {
  const [text, setText] = useState("");
  const mine = notes.filter((n) => n.driver.toLowerCase() === run.name.toLowerCase());
  // A team panel only writes the team's own notes; stewards keep theirs apart from every team's.
  const groups: { key: string; label: string; list: DriverNote[] }[] = team
    ? [{ key: "team", label: "", list: mine.filter((n) => n.team === team) }]
    : [
        { key: "stewards", label: "Steward notes", list: mine.filter((n) => !n.team) },
        ...[...new Set(mine.filter((n) => n.team).map((n) => n.team!))].map((t) => ({ key: t, label: `${mine.find((n) => n.team === t)?.teamName ?? "Team"} notes`, list: mine.filter((n) => n.team === t) })),
      ];
  const add = async () => {
    const cmd = team ? ({ type: "teamNote", team, runId: run.id, text } as const) : ({ type: "note", runId: run.id, text } as const);
    if (text.trim() && (await send(cmd))) setText("");
  };
  const del = (n: DriverNote) => send(n.team && team ? { type: "teamNoteDel", team, id: n.id } : { type: "noteDel", id: n.id });
  return (
    <Dialog title={`${team ? "Team notes" : "Notes"}: ${run.name}`} size="l" onClose={onClose} foot={<button className="r-btn" onClick={onClose}>Close</button>}>
      {mine.length === 0 || groups.every((g) => g.list.length === 0) ? (
        <div className="r-empty">No notes.</div>
      ) : (
        <div className="r-stack">
          {groups.filter((g) => g.list.length).map((g) => (
            <div key={g.key} className="r-stack">
              {g.label && <span className="r-label">{g.label}</span>}
              <div className="r-log r-log--wrap" style={{ maxHeight: 200 }}>
                {g.list.map((n) => (
                  <div className="r-row" key={n.id} style={{ alignItems: "flex-start", gap: 4 }}>
                    <div className={`r-log__line r-fill${n.team && !team ? " is-teal" : ""}`}>{noteTime.format(n.at)} {n.by}: {n.text}</div>
                    <button className="r-cell" style={{ height: 19 }} onClick={() => del(n)}>Delete</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {(!team || run.team === team) && (
        <>
          <div className="r-form-field">
            <span className="r-label">New note</span>
            <textarea className="r-field" style={{ height: 64, resize: "none" }} aria-label="New note" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <button className="r-btn" disabled={!text.trim()} onClick={add}>Add note</button>
        </>
      )}
    </Dialog>
  );
}

/** Give a running car a finish time: a pending finish, or the time another car was given by mistake. */
export function AttributeDialog({ run, state, team, onClose, send }: { run: Run; state: RaceState; team?: string; onClose: () => void; send: Send }) {
  const start = run.startedAt ?? Infinity;
  const options: { key: string; label: string; cmd: import("../../shared/commands").Command }[] = [];
  for (const ts of state.pending) {
    if (ts < start || (team && state.pendingTeam?.[ts] !== team)) continue;
    options.push({
      key: `p${ts}`,
      label: `Unattributed finish at ${new Date(ts).toLocaleTimeString("en-GB")}: ${fmtTime(ts - start)}`,
      cmd: { type: "assign", ts, runId: run.id, team },
    });
  }
  for (const r of state.runs) {
    if (r.id === run.id || r.status !== "finished" || r.startedAt == null || r.rawMs == null) continue;
    if (team && r.team !== team) continue;
    const ts = r.startedAt + r.rawMs;
    if (ts < start) continue;
    options.push({
      key: `r${r.id}`,
      label: `Time of ${r.name} (${carId(r) || "unassigned"}): ${fmtTime(ts - start)}`,
      cmd: { type: "reattribute", fromRunId: r.id, runId: run.id, team },
    });
  }
  const [pick, setPick] = useState(options[0]?.key ?? "");
  const chosen = options.find((o) => o.key === pick);
  return (
    <Dialog
      title={`Attribute time: ${run.name}`}
      size="l"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button
            className="r-btn"
            disabled={!chosen}
            onClick={async () => {
              if (chosen && (await send(chosen.cmd))) onClose();
            }}
          >
            Attribute
          </button>
        </>
      }
    >
      {options.length === 0 ? (
        <div className="r-text--dim">No time to attribute. Remove a time from another car first, or set one by hand.</div>
      ) : (
        <div className="r-grid" style={{ ["--cols" as string]: 1 }}>
          {options.map((o) => (
            <button key={o.key} className="r-btn" aria-pressed={pick === o.key} onClick={() => setPick(o.key)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** Plate and driver number, filled in by stewards once the car is handed over. */
export function EditInfoDialog({ run, onClose, send }: { run: Run; onClose: () => void; send: Send }) {
  const [plate, setPlate] = useState(run.plate);
  const [number, setNumber] = useState(run.number ?? "");
  const ok = !!(plate.trim() || number.trim());
  const submit = async () => {
    if (ok && (await send({ type: "editInfo", runId: run.id, plate, number }))) onClose();
  };
  return (
    <Dialog
      title={`Edit info: ${run.name}`}
      size="s"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn" disabled={!ok} onClick={submit}>Save</button>
        </>
      }
    >
      <div className="r-form-field">
        <span className="r-label">Plate</span>
        <input className="r-field" aria-label="Plate" maxLength={12} value={plate} onChange={(e) => setPlate(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      <div className="r-form-field">
        <span className="r-label">Driver number</span>
        <input className="r-field" aria-label="Driver number" maxLength={4} value={number} onChange={(e) => setNumber(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
    </Dialog>
  );
}

/** Enter a stage time by hand, as mm:ss.mmm. */
export function SetTimeDialog({ run, team, onClose, send }: { run: Run; team?: string; onClose: () => void; send: Send }) {
  const [text, setText] = useState(run.rawMs != null ? fmtTime(run.rawMs) : "");
  const m = /^(\d{1,3}):([0-5]?\d)(?:\.(\d{1,3}))?$/.exec(text.trim());
  const ms = m ? Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number((m[3] ?? "").padEnd(3, "0")) : null;
  const ok = ms != null && ms >= 100;
  const submit = async () => {
    if (ok && (await send({ type: "setTime", runId: run.id, ms, team }))) onClose();
  };
  return (
    <Dialog
      title={`Set time: ${run.name}`}
      size="s"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn" disabled={!ok} onClick={submit}>Set</button>
        </>
      }
    >
      <div className="r-form-field">
        <span className="r-label">Time, mm:ss.mmm</span>
        <input className="r-field" aria-label="Time" placeholder="01:23.456" maxLength={10} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
    </Dialog>
  );
}
