import { useCallback, useEffect, useState } from "react";
import { eventProblem, fmtPoints, fmtSpan, parseGap, parseTime, type ChampEvent, type ScoringMode, type StandingsData } from "../../shared/standings";
import { admin } from "../api";
import { scoringText } from "../Standings";
import { Dialog, toast } from "../ui";

type Data = StandingsData & { teams: string[] };

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const toLocalInput = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const say = (e: string) => toast(e === "invalid" ? "Check the values and try again." : e === "not_found" ? "Not found." : "Request failed.");

export function StandingsTab() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState<{ event?: ChampEvent } | null>(null);
  const [del, setDel] = useState<ChampEvent | null>(null);
  const reload = useCallback(() => {
    admin.standings().then(setData, () => setFailed(true));
  }, []);
  useEffect(reload, [reload]);

  const toggleHalf = async (e: ChampEvent, half: boolean) => {
    setData((d) => d && { ...d, events: d.events.map((x) => (x.id === e.id ? { ...x, half } : x)) });
    const r = await admin.setHalf(e.id, half);
    if (!r.ok) say(r.error);
    reload();
  };

  if (failed) return <div className="r-panel"><div className="r-empty">Could not load standings.</div></div>;
  if (!data) return null;
  const events = [...data.events].sort((a, b) => b.heldAt - a.heldAt);
  return (
    <>
      <PointsPanel data={data} onSaved={reload} />
      <div className="r-panel">
        <div className="r-header">Events</div>
        <div className="r-row" style={{ padding: 4 }}>
          <button className="r-btn pri" style={{ width: 160 }} onClick={() => setForm({})}>Add results</button>
        </div>
        {events.length === 0 ? (
          <div className="r-empty">No events.</div>
        ) : (
          <table className="r-table">
            <thead>
              <tr>
                <th className="is-left">Name</th>
                <th className="is-left" style={{ width: 110 }}>Date</th>
                <th style={{ width: 70 }}>Drivers</th>
                <th className="is-left">Scoring</th>
                <th style={{ width: 90 }}>Half points</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="is-left">{e.name}</td>
                  <td className="is-left" style={{ color: "var(--r-text-dim)" }}>{dateFmt.format(e.heldAt)}</td>
                  <td>{e.results.length}</td>
                  <td className="is-left" style={{ color: "var(--r-text-dim)" }}>{scoringText({ ...e, half: false }, data.config.windowMs)}</td>
                  <td>
                    <label className="r-check" style={{ justifyContent: "center" }}>
                      <input type="checkbox" aria-label={`${e.name} half points`} checked={e.half} disabled={!!e.sessionId} onChange={(ev) => toggleHalf(e, ev.target.checked)} />
                    </label>
                  </td>
                  <td style={{ padding: 2 }}>
                    {e.sessionId ? (
                      <span style={{ color: "var(--r-text-dim)" }}>Session</span>
                    ) : (
                      <div className="r-grid" style={{ ["--cols" as string]: 2 }}>
                        <button className="r-cell" onClick={() => setForm({ event: e })}>Edit</button>
                        <button className="r-cell r-cell--red" onClick={() => setDel(e)}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {form && <EventForm data={data} event={form.event} onDone={() => { setForm(null); reload(); }} onClose={() => setForm(null)} />}
      {del && (
        <Dialog
          title="Delete event"
          size="s"
          onClose={() => setDel(null)}
          foot={
            <>
              <button className="r-btn" onClick={() => setDel(null)}>Cancel</button>
              <button className="r-btn" onClick={async () => { await admin.deleteEvent(del.id); setDel(null); reload(); }}>Delete</button>
            </>
          }
        >
          <div>{del.name} and its results are removed from the standings.</div>
        </Dialog>
      )}
    </>
  );
}

function PointsPanel({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const [points, setPoints] = useState(data.config.points.map(fmtPoints).join(", "));
  const [windowS, setWindowS] = useState(String(data.config.windowMs / 1000));
  const list = points.split(/[\s,;]+/).filter(Boolean).map(Number);
  const w = Math.round(Number(windowS.replace(",", ".")) * 1000);
  const ok = list.length > 0 && list.length <= 50 && list.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000) && Number.isInteger(w) && w >= 1 && w <= 600000;
  const changed = list.join() !== data.config.points.join() || w !== data.config.windowMs;
  const save = async () => {
    const r = await admin.setPoints({ points: list, windowMs: w });
    if (!r.ok) return say(r.error);
    toast("Points saved.", "green");
    onSaved();
  };
  return (
    <div className="r-panel">
      <div className="r-header">Points</div>
      <div className="r-row" style={{ padding: 4 }}>
        <div className="r-form-field r-fill">
          <span className="r-label">Points for first place, second place, and so on</span>
          <input className="r-field" aria-label="Points by place" value={points} onChange={(e) => setPoints(e.target.value)} />
        </div>
        <div className="r-form-field" style={{ width: 150 }}>
          <span className="r-label">Window (s)</span>
          <input className="r-field" inputMode="decimal" aria-label="Window in seconds" value={windowS} onChange={(e) => setWindowS(e.target.value)} />
        </div>
        <button className="r-btn pri" style={{ width: 120 }} disabled={!ok || !changed} onClick={save}>Save</button>
      </div>
    </div>
  );
}

const OTHER = "\u0000other";

/** Team of one result: none, one of the teams we hold, or a name typed in (for a team that no longer exists). */
function TeamPick({ label, value, teams, onChange }: { label: string; value: string; teams: string[]; onChange: (team: string) => void }) {
  const [other, setOther] = useState(() => !!value && !teams.includes(value));
  return (
    <div style={{ flex: "1 1 90px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <div className="r-select">
        <select
          aria-label={label}
          value={other ? OTHER : value}
          onChange={(e) => {
            const v = e.target.value;
            setOther(v === OTHER);
            onChange(v === OTHER ? (teams.includes(value) ? "" : value) : v);
          }}
        >
          <option value="">No team</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          <option value={OTHER}>Other...</option>
        </select>
      </div>
      {other && <input className="r-field" style={{ width: "auto", minWidth: 0 }} aria-label={`${label} name`} placeholder="Team name" maxLength={60} value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

interface FormRow {
  username: string;
  team: string;
  time: string;
  gap: string;
}
const blank = (): FormRow => ({ username: "", team: "", time: "", gap: "" });
const spanText = (ms: number | null) => (ms == null ? "" : fmtSpan(ms));

function EventForm({ data, event, onDone, onClose }: { data: Data; event?: ChampEvent; onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState(event?.name ?? "");
  const [when, setWhen] = useState(() => toLocalInput(event?.heldAt ?? Date.now()));
  const [mode, setMode] = useState<ScoringMode>(event?.mode ?? "position");
  const [half, setHalf] = useState(event?.half ?? false);
  const [window_, setWindow] = useState(event?.windowMs != null ? String(event.windowMs / 1000) : "");
  const [rows, setRows] = useState<FormRow[]>(() =>
    event ? [...event.results].sort((a, b) => a.position - b.position).map((r) => ({ username: r.username, team: r.teamName ?? "", time: spanText(r.timeMs), gap: spanText(r.gapMs) })) : [blank(), blank(), blank()],
  );
  const set = (i: number, patch: Partial<FormRow>) => setRows((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((l) => {
      const n = [...l];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });

  const filled = rows.filter((r) => r.username.trim());
  const bad = filled.find((r) => (r.time.trim() && parseTime(r.time) == null) || (r.gap.trim() && parseGap(r.gap) == null));
  const results = filled.map((r, i) => ({
    position: i + 1,
    username: r.username.trim(),
    teamId: null,
    teamName: r.team.trim() || null,
    timeMs: r.time.trim() ? parseTime(r.time) : null,
    gapMs: r.gap.trim() ? parseGap(r.gap) : null,
  }));
  const windowMs = window_.trim() ? Math.round(Number(window_.replace(",", ".")) * 1000) : null;
  const heldAt = new Date(when).getTime();
  const problem = bad ? `${bad.username}: use a time such as 1:23.456 and an interval such as 0.250.` : eventProblem({ name, heldAt, mode, windowMs, results });
  const save = async () => {
    if (problem) return;
    const body = { name: name.trim(), heldAt, half, mode, windowMs: mode === "window" ? windowMs : null, results };
    const r = event ? await admin.saveEvent(event.id, body) : await admin.createEvent(body);
    if (!r.ok) return say(r.error);
    toast("Results saved.", "green");
    onDone();
  };
  // Pasting a list of names (one per line) into a username box fills the rows from there.
  const paste = (i: number, text: string) => {
    const names = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (names.length < 2) return false;
    setRows((l) => [...l.slice(0, i), ...names.map((username) => ({ ...blank(), username })), ...l.slice(i + 1)]);
    return true;
  };

  return (
    <Dialog
      title={event ? "Edit results" : "Add results"}
      size="l"
      onClose={onClose}
      foot={
        <>
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn pri" disabled={!!problem} onClick={save}>Save</button>
        </>
      }
    >
      <div className="r-row">
        <div className="r-form-field r-fill">
          <span className="r-label">Name</span>
          <input className="r-field" aria-label="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="r-form-field r-fill">
          <span className="r-label">Date</span>
          <input className="r-field" style={{ colorScheme: "dark" }} type="datetime-local" aria-label="Date" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
      </div>
      <div className="r-row">
        <div className="r-form-field r-fill">
          <span className="r-label">Points by</span>
          <div className="r-select">
            <select aria-label="Scoring" value={mode} onChange={(e) => setMode(e.target.value as ScoringMode)}>
              <option value="position">Finishing order</option>
              <option value="window">Time windows</option>
            </select>
          </div>
        </div>
        {mode === "window" && (
          <div className="r-form-field" style={{ width: 150 }}>
            <span className="r-label">Window (s)</span>
            <input className="r-field" inputMode="decimal" aria-label="Window in seconds" placeholder={String(data.config.windowMs / 1000)} value={window_} onChange={(e) => setWindow(e.target.value)} />
          </div>
        )}
        <label className="r-check" style={{ alignSelf: "flex-end", minHeight: 24 }}>
          <input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} />
          <span>Half points</span>
        </label>
      </div>
      {mode === "window" && <div className="note">The fastest time scores first-place points, and so does everyone within one window of it. Each further window scores the next place. Needs a time for every driver, or an interval for every driver after the winner.</div>}
      <div className="r-stack">
        {rows.map((r, i) => (
          <div className="r-row" key={i}>
            <span style={{ width: 22, textAlign: "center", fontWeight: "bold" }}>{r.username.trim() ? rows.slice(0, i).filter((x) => x.username.trim()).length + 1 : ""}</span>
            <input className="r-field" style={{ flex: "1 1 90px", width: "auto", minWidth: 0 }} aria-label={`Driver ${i + 1}`} placeholder="Driver" maxLength={20} value={r.username} onChange={(e) => set(i, { username: e.target.value })} onPaste={(e) => paste(i, e.clipboardData.getData("text")) && e.preventDefault()} />
            <TeamPick label={`Team ${i + 1}`} value={r.team} teams={data.teams} onChange={(team) => set(i, { team })} />
            <input className="r-field" style={{ flex: "0 1 84px", width: "auto", minWidth: 0 }} aria-label={`Time ${i + 1}`} placeholder="Time" value={r.time} onChange={(e) => set(i, { time: e.target.value })} />
            <input className="r-field" style={{ flex: "0 1 70px", width: "auto", minWidth: 0 }} aria-label={`Interval ${i + 1}`} placeholder="Interval" value={r.gap} onChange={(e) => set(i, { gap: e.target.value })} />
            <div className="r-grid" style={{ flexWrap: "nowrap" }}>
              <button className="r-cell" aria-label={`Move ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
              <button className="r-cell" aria-label={`Move ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>Down</button>
              <button className="r-cell r-cell--red" aria-label={`Remove ${i + 1}`} onClick={() => setRows((l) => l.filter((_, j) => j !== i))}>X</button>
            </div>
          </div>
        ))}
      </div>
      <div className="note">Time and interval are optional. Time is like 1:23.456; interval is to the driver ahead, like 0.250. Paste a list of names into a Driver box to fill the rows.</div>
      <div className="r-row">
        <button className="r-btn" onClick={() => setRows((l) => [...l, blank()])}>Add driver</button>
        {problem && filled.length > 0 && <span className="r-form-field__error">{problem}</span>}
      </div>
    </Dialog>
  );
}
