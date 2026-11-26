import { useEffect, useState } from "react";
import { carName, type Car } from "../../shared/registration";
import { eventProblem, fmtSpan, parseGap, parseTime, type ResultRow } from "../../shared/standings";
import type { SessionSummary } from "../../shared/types";
import { admin, api, registrationApi } from "../api";
import { Dialog, toast } from "../ui";

interface FormRow {
  car: string;
  team: string;
  time: string;
  gap: string;
  /** The stint log: who drove, in order. */
  drivers: string[];
}
const blank = (): FormRow => ({ car: "", team: "", time: "", gap: "", drivers: [""] });
const spanText = (ms: number | null) => (ms == null ? "" : fmtSpan(ms));
const say = (e: string) => toast(e === "invalid" ? "Check the values and try again." : e === "not_found" ? "Not found." : "Request failed.");

/** Typed-in results of one session: a car with the drivers who drove it, or a single driver. A car's points are split equally between its drivers. */
export function ResultsDialog({ session, onClose }: { session: SessionSummary; onClose: () => void }) {
  const [rows, setRows] = useState<FormRow[] | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [had, setHad] = useState(false);

  useEffect(() => {
    Promise.all([admin.sessionResults(session.id), registrationApi.get(session.id).catch(() => null), api.teams().catch(() => [])]).then(([r, reg, t]) => {
      setCars(reg?.cars ?? []);
      setTeams(t.map((x) => x.name).sort((a, b) => a.localeCompare(b)));
      const list = [...r.results].sort((a, b) => a.position - b.position);
      setHad(list.length > 0);
      setRows(list.length > 0 ? list.map((x) => ({ car: x.car ?? "", team: x.teamName ?? "", time: spanText(x.timeMs), gap: spanText(x.gapMs), drivers: x.drivers?.length ? x.drivers.map((d) => d.username) : [x.username] })) : [blank(), blank(), blank()]);
    }, () => setRows([]));
  }, [session.id]);

  if (!rows) return null;
  const set = (i: number, patch: Partial<FormRow>) => setRows((l) => l && l.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((l) => {
      const n = [...(l ?? [])];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const pickCar = (i: number, name: string) => {
    const c = cars.find((x) => carName(x) === name);
    if (!c) return set(i, { car: "" });
    const racing = c.drivers.filter((d) => d.race).map((d) => d.username);
    set(i, { car: name, team: c.teamName, drivers: racing.length > 0 ? racing : [""] });
  };
  const setDriver = (i: number, k: number, v: string) => set(i, { drivers: rows[i].drivers.map((d, j) => (j === k ? v : d)) });

  const filled = rows.filter((r) => r.drivers.some((d) => d.trim()));
  const bad = filled.find((r) => (r.time.trim() && parseTime(r.time) == null) || (r.gap.trim() && parseGap(r.gap) == null));
  const results: ResultRow[] = filled.map((r, i) => {
    const names = r.drivers.map((d) => d.trim()).filter(Boolean);
    return {
      position: i + 1,
      username: names[0],
      car: r.car || null,
      drivers: names.length > 1 || r.car ? names.map((username) => ({ username })) : undefined,
      teamId: null,
      teamName: r.team.trim() || null,
      timeMs: r.time.trim() ? parseTime(r.time) : null,
      gapMs: r.gap.trim() ? parseGap(r.gap) : null,
    };
  });
  const problem = bad ? `${bad.drivers[0]}: use a time such as 1:23.456 and an interval such as 0.250.` : results.length === 0 ? "Add at least one driver." : eventProblem({ name: session.name, heldAt: session.startsAt, mode: session.scoring, windowMs: session.windowMs, results });
  const save = async () => {
    if (problem) return;
    const body = filled.map((r, i) => ({ car: r.car || null, teamName: r.team.trim() || null, timeMs: results[i].timeMs, gapMs: results[i].gapMs, drivers: r.drivers.map((d) => d.trim()).filter(Boolean) }));
    const r = await admin.saveSessionResults(session.id, body);
    if (!r.ok) return say(r.error);
    toast("Results saved.", "green");
    onClose();
  };
  const clear = async () => {
    const r = await admin.clearSessionResults(session.id);
    if (!r.ok) return say(r.error);
    toast("Results removed.", "green");
    onClose();
  };
  const field = (w: string) => ({ flex: `0 1 ${w}`, width: "auto", minWidth: 0 }) as const;

  return (
    <Dialog
      title={`Results: ${session.name}`}
      size="l"
      onClose={onClose}
      foot={
        <>
          {had && <button className="r-btn" onClick={clear}>Remove results</button>}
          <button className="r-btn" onClick={onClose}>Cancel</button>
          <button className="r-btn pri" disabled={!!problem} onClick={save}>Save</button>
        </>
      }
    >
      <div className="note">
        {session.championship
          ? `Points: ${session.scoring === "window" ? "by time window" : "by finishing order"}${session.halfPoints ? ", half points" : ""}. A car's points are split equally between the drivers who drove it.`
          : "This session does not count for the championship, so no points are awarded. Turn it on in the session settings."}
      </div>
      <div className="r-stack">
        {rows.map((r, i) => (
          <div className="r-stack" key={i} style={{ paddingBottom: 4, borderBottom: "1px solid var(--r-line, var(--r-text-dim))" }}>
            <div className="r-row">
              <span style={{ width: 22, textAlign: "center", fontWeight: "bold" }}>{r.drivers.some((d) => d.trim()) ? rows.slice(0, i).filter((x) => x.drivers.some((d) => d.trim())).length + 1 : ""}</span>
              {cars.length > 0 && (
                <div className="r-select" style={{ flex: "1 1 110px", minWidth: 0 }}>
                  <select aria-label={`Car ${i + 1}`} value={r.car} onChange={(e) => pickCar(i, e.target.value)}>
                    <option value="">No car</option>
                    {r.car && !cars.some((c) => carName(c) === r.car) && <option value={r.car}>{r.car}</option>}
                    {cars.map((c) => <option key={c.id} value={carName(c)}>{carName(c)} · {c.teamName}</option>)}
                  </select>
                </div>
              )}
              <div className="r-select" style={{ flex: "1 1 90px", minWidth: 0 }}>
                <select aria-label={`Team ${i + 1}`} value={r.team} onChange={(e) => set(i, { team: e.target.value })}>
                  <option value="">No team</option>
                  {r.team && !teams.includes(r.team) && <option value={r.team}>{r.team}</option>}
                  {teams.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <input className="r-field" style={field("84px")} aria-label={`Time ${i + 1}`} placeholder="Time" value={r.time} onChange={(e) => set(i, { time: e.target.value })} />
              <input className="r-field" style={field("70px")} aria-label={`Interval ${i + 1}`} placeholder="Interval" value={r.gap} onChange={(e) => set(i, { gap: e.target.value })} />
              <div className="r-grid" style={{ flexWrap: "nowrap" }}>
                <button className="r-cell" aria-label={`Move ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
                <button className="r-cell" aria-label={`Move ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>Down</button>
                <button className="r-cell r-cell--red" aria-label={`Remove result ${i + 1}`} onClick={() => setRows((l) => l && l.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
            <div className="r-row" style={{ paddingLeft: 26 }}>
              <span className="r-label" style={{ width: 54 }}>Drivers</span>
              <div className="r-row" style={{ flex: "1 1 0", minWidth: 0, flexWrap: "wrap" }}>
              {r.drivers.map((d, k) => (
                <div className="r-row" key={k} style={{ gap: 2, flex: "0 1 auto" }}>
                  <input className="r-field" style={field("120px")} aria-label={`Driver ${k + 1} of result ${i + 1}`} placeholder={`Stint ${k + 1}`} maxLength={20} value={d} onChange={(e) => setDriver(i, k, e.target.value)} />
                  {r.drivers.length > 1 && <button className="r-cell r-cell--red" aria-label={`Remove driver ${k + 1} of result ${i + 1}`} onClick={() => set(i, { drivers: r.drivers.filter((_, j) => j !== k) })}>Remove</button>}
                </div>
              ))}
              <button className="r-btn" style={{ width: 130 }} onClick={() => set(i, { drivers: [...r.drivers, ""] })}>Add stint</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="note">Drivers are listed in the order they drove; a driver who drives again is added again and still counts once. Time and interval are optional.</div>
      <div className="r-row">
        <button className="r-btn" onClick={() => setRows((l) => l && [...l, blank()])}>Add result</button>
        {problem && filled.length > 0 && <span className="r-form-field__error">{problem}</span>}
      </div>
    </Dialog>
  );
}
