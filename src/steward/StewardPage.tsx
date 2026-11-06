import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Command } from "../../shared/commands";
import { classify, fmtPenalty, type Flag, type Run } from "../../shared/race";
import type { RaceSummary } from "../../shared/types";
import { api, raceAccess, sendCommand } from "../api";
import { ClassificationTable } from "../ClassificationTable";
import { useMe } from "../me";
import { NotFound } from "../NotFound";
import { Topbar, VERSION } from "../Shell";
import { fmtLive, toast, useNow } from "../ui";
import { useRaceLive } from "../useRaceLive";
import { AssignDialog, ConfirmDnf, ConfirmReset, PenaltyDialog, RecipientsDialog, RulesDialog } from "./Dialogs";

const ERRORS: Record<string, string> = {
  not_queued: "Only queued drivers can be removed.",
  not_running: "That car is not running.",
  not_found: "Not found. The state may have changed.",
  no_queue: "The queue is empty.",
  invalid: "Invalid value.",
  forbidden: "You are not a steward of this race.",
  unauthorized: "Sign in again.",
};

type DialogState =
  | null
  | { kind: "reset" }
  | { kind: "rules" }
  | { kind: "recipients" }
  | { kind: "penalty"; runId: string }
  | { kind: "dnf"; runId: string }
  | { kind: "assign"; ts: number };

const PRESETS = [15, 30, 45, 60];

export function StewardPage() {
  const { id = "" } = useParams();
  const { me, setMe } = useMe();
  const nav = useNavigate();
  const [race, setRace] = useState<RaceSummary | null | undefined>(undefined);
  const [access, setAccess] = useState<boolean | null>(null);

  useEffect(() => {
    api.race(id).then(setRace, () => setRace(null));
  }, [id]);
  useEffect(() => {
    setAccess(null);
    if (me) raceAccess(id).then((a) => setAccess(a.steward), () => setAccess(false));
  }, [id, me]);

  if (race === null) return <NotFound />;
  if (!me) {
    return (
      <div className="r-screen">
        <div className="r-dialog">
          <div className="r-header">Sign in</div>
          <div className="r-dialog__foot">
            <button className="r-btn r-btn--advance r-fill" onClick={() => location.assign("/api/auth/roblox/login")}>
              <span>Sign in with Roblox</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (access === false) {
    return (
      <div className="r-screen">
        <div className="r-dialog">
          <div className="r-header">Access denied</div>
          <div className="r-dialog__body r-dialog__body--center">
            <div className="r-plate is-red" style={{ width: "100%", height: 56, fontSize: 32 }}>403</div>
            <div>You are not a steward of this race.</div>
          </div>
          <div className="r-dialog__foot">
            <button className="r-btn" onClick={() => nav("/")}>Home</button>
            <button
              className="r-btn"
              onClick={async () => {
                await api.logout();
                setMe(null);
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!access || !race) return <div className="r-screen" />;
  return <Panel raceId={id} race={race} />;
}

function Panel({ raceId, race }: { raceId: string; race: RaceSummary }) {
  const nav = useNavigate();
  const { state, live, offset } = useRaceLive(raceId, true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [to, setTo] = useState<string[] | "all">("all");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const closeDialog = () => setDialog(null);
  const hasTimers = !!state && state.runs.some((r) => r.status === "onstage") || !!state?.lastReleaseAt;
  const now = useNow(offset, hasTimers);

  const send = async (cmd: Command) => {
    const err = await sendCommand(raceId, cmd);
    if (err) toast(ERRORS[err] ?? "Command failed.");
    return !err;
  };

  const logRef = useRef<HTMLDivElement>(null);
  const radioRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    if (radioRef.current) radioRef.current.scrollTop = radioRef.current.scrollHeight;
  }, [state?.log.length, state?.radio.length]);

  const rows = useMemo(() => (state ? classify(state.runs) : []), [state]);
  if (!state) return <div className="r-screen" />;

  const queued = state.runs.filter((r) => r.status === "queued");
  const onTrack = state.runs.filter((r) => r.status === "onstage");
  const byId = (id: string) => state.runs.find((r) => r.id === id);
  const next = queued[0];
  const counting = onTrack.filter((r) => r.startedAt! > now);
  const releaseLeft = state.lastReleaseAt ? Math.max(0, state.lastReleaseAt + state.cadenceSec * 1000 - now) : 0;
  const releaseValue = state.lastReleaseAt ? 1 - releaseLeft / (state.cadenceSec * 1000) : 0;
  const radioTarget = to === "all" ? "all" : to.filter((i) => byId(i));
  const canTransmit = text.trim() !== "" && (radioTarget === "all" || radioTarget.length > 0);

  const transmit = async () => {
    if (!canTransmit) return;
    if (await send({ type: "radio", to: radioTarget, text })) setText("");
  };
  const stage = async () => {
    if (!name.trim() || !plate.trim()) return;
    if (await send({ type: "add", name, plate })) {
      setName("");
      setPlate("");
    }
  };
  const dialogRun = dialog && "runId" in dialog ? byId(dialog.runId) : undefined;
  const flags: [Flag, string][] = [["green", "Green"], ["yellow", "Yellow"], ["red", "Red"]];

  return (
    <div className="page">
      <Topbar>
        <span className="r-text r-text--dim">{race.name}</span>
        <button className="r-btn" onClick={() => nav(`/race/${raceId}`)}>Timing</button>
      </Topbar>
      <div className="page__body" style={{ justifyContent: "stretch", padding: 8 }}>
        <div className="r-row" style={{ gap: 8, alignItems: "flex-start", width: "100%" }}>
          <div className="r-stack r-fill" style={{ gap: 8 }}>
            <div className="r-panel">
              <div className="r-header">Flag</div>
              <div className="r-row" style={{ padding: 4, background: "var(--r-chrome)" }}>
                {flags.map(([f, label]) => (
                  <button key={f} className="r-btn r-fill" aria-pressed={state.flag === f} onClick={() => state.flag !== f && send({ type: "flag", flag: f })}>
                    {label}
                  </button>
                ))}
                <button className="r-cell r-cell--red r-cell--wide" style={{ marginLeft: 8 }} onClick={() => setDialog({ kind: "reset" })}>
                  Reset stage
                </button>
              </div>
            </div>

            <div className="r-module">
              <div className="r-header">Start line</div>
              <div className="r-module__well" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="r-row" style={{ alignItems: "center" }}>
                  <div className="r-readout r-fill" style={{ justifyContent: "flex-start", height: 42 }}>
                    {counting.length > 0
                      ? `${counting[0].name}  ${Math.ceil((counting[0].startedAt! - now) / 1000)}`
                      : next
                        ? `${next.name}  ${next.plate}`
                        : ""}
                  </div>
                  <button className="r-btn r-btn--advance" style={{ width: 160 }} disabled={!next} onClick={() => send({ type: "go" })}>
                    <span>GO</span>
                  </button>
                </div>
                <div className="r-row" style={{ alignItems: "center" }}>
                  <span className="r-label">Release every</span>
                  <div className="r-stepper">
                    <button className="r-cell" aria-label="Less" onClick={() => send({ type: "cadence", sec: Math.max(5, state.cadenceSec - 5) })}>-</button>
                    <div className="r-readout">{state.cadenceSec}s</div>
                    <button className="r-cell" aria-label="More" onClick={() => send({ type: "cadence", sec: Math.min(600, state.cadenceSec + 5) })}>+</button>
                  </div>
                  {PRESETS.map((p) => (
                    <button key={p} className={`r-cell${state.cadenceSec === p ? " is-on" : ""}`} style={{ width: 40 }} onClick={() => send({ type: "cadence", sec: p })}>
                      {p}
                    </button>
                  ))}
                  <div className="r-fill">
                    <div className="r-progress" style={{ ["--value" as string]: releaseValue }} aria-label="Time to next release" />
                  </div>
                  <div className="r-readout" style={{ minWidth: 64 }}>{state.lastReleaseAt ? fmtLive(releaseLeft).slice(0, 5) : "--:--"}</div>
                </div>
              </div>
            </div>

            <div className="r-panel">
              <div className="r-header">Staging queue</div>
              <table className="r-table r-queue">
                <thead>
                  <tr>
                    <th className="is-left" style={{ width: 40 }}>No</th>
                    <th className="is-left">Driver</th>
                    <th style={{ width: 100 }}>Plate</th>
                    <th style={{ width: 150 }} />
                  </tr>
                </thead>
                <tbody>
                  {queued.map((r, i) => (
                    <tr key={r.id}>
                      <td className="is-left">{i + 1}</td>
                      <td className="is-left">{r.name}</td>
                      <td>{r.plate}</td>
                      <td>
                        <div className="r-row" style={{ justifyContent: "flex-end" }}>
                          <button className="r-cell" aria-label="Move up" disabled={i === 0} onClick={() => send({ type: "move", runId: r.id, dir: -1 })}>↑</button>
                          <button className="r-cell" aria-label="Move down" disabled={i === queued.length - 1} onClick={() => send({ type: "move", runId: r.id, dir: 1 })}>↓</button>
                          <button className="r-cell" onClick={() => send({ type: "remove", runId: r.id })}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {queued.length === 0 && <div className="r-empty">Queue is empty.</div>}
              <div className="r-row" style={{ padding: 4, background: "var(--r-chrome)" }}>
                <input className="r-field r-fill" placeholder="Driver" aria-label="Driver name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && stage()} />
                <input className="r-field" style={{ width: 120 }} placeholder="Plate" aria-label="Plate" value={plate} onChange={(e) => setPlate(e.target.value)} onKeyDown={(e) => e.key === "Enter" && stage()} />
                <button className="r-btn" style={{ width: 110 }} disabled={!name.trim() || !plate.trim()} onClick={stage}>Stage</button>
              </div>
            </div>

            <div className="r-panel">
              <div className="r-header">On track</div>
              {onTrack.length === 0 ? (
                <div className="r-empty">No cars on track.</div>
              ) : (
                <table className="r-table r-queue">
                  <thead>
                    <tr>
                      <th className="is-left">Driver</th>
                      <th style={{ width: 100 }}>Time</th>
                      <th style={{ width: 90 }}>Pen</th>
                      <th style={{ width: 250 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {onTrack.map((r) => (
                      <tr key={r.id}>
                        <td className="is-left">{r.name}</td>
                        <td>{r.startedAt! > now ? "" : fmtLive(now - r.startedAt!)}</td>
                        <td className={r.penaltyMs ? "is-red" : ""}>{r.penaltyMs ? fmtPenalty(r.penaltyMs) : ""}</td>
                        <td>
                          <div className="r-row" style={{ justifyContent: "flex-end" }}>
                            <button className="r-cell" onClick={() => setDialog({ kind: "penalty", runId: r.id })}>Penalty</button>
                            <button className="r-cell r-cell--red" onClick={() => setDialog({ kind: "dnf", runId: r.id })}>DNF</button>
                            <button className="r-cell" disabled={r.startedAt! > now} onClick={() => send({ type: "finish", runId: r.id })}>Finish</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {state.pending.map((ts) => (
                <div className="r-banner" key={ts} style={{ marginTop: 4 }}>
                  <span>Pending finish {new Date(ts).toLocaleTimeString("en-GB")}</span>
                  <div className="r-row" style={{ marginLeft: "auto" }}>
                    <button className="r-cell r-cell--wide" onClick={() => setDialog({ kind: "assign", ts })}>Assign</button>
                    <button className="r-cell r-cell--wide" onClick={() => send({ type: "discard", ts })}>Discard</button>
                  </div>
                </div>
              ))}
              <div className="r-row" style={{ padding: 4, background: "var(--r-chrome)" }}>
                <button className="r-btn r-btn--advance r-fill" onClick={() => send({ type: "finish" })}>
                  <span>Stop timer</span>
                </button>
              </div>
            </div>

            <div className="r-panel">
              <div className="r-header">Classification</div>
              {rows.length === 0 ? (
                <div className="r-empty">No runs recorded.</div>
              ) : (
                <ClassificationTable
                  rows={rows}
                  action={(r) =>
                    (r.status === "finished" || r.status === "onstage") && (
                      <button className="r-cell" style={{ height: 19 }} onClick={() => setDialog({ kind: "penalty", runId: r.id })}>Penalties</button>
                    )
                  }
                />
              )}
            </div>
          </div>

          <div className="r-stack" style={{ width: 320, gap: 8, flex: "none" }}>
            <div className="r-panel">
              <div className="r-header">Radio</div>
              <div className="r-stack" style={{ padding: 4, background: "var(--r-chrome)" }}>
                <div className="r-grid" style={{ ["--cols" as string]: 2 }}>
                  <button className={`r-cell${to === "all" ? " is-on" : ""}`} aria-pressed={to === "all"} onClick={() => setTo("all")}>All drivers</button>
                  <button className={`r-cell${to !== "all" ? " is-on" : ""}`} aria-pressed={to !== "all"} onClick={() => setDialog({ kind: "recipients" })}>
                    {to === "all" ? "Selected" : `Selected (${radioTarget.length})`}
                  </button>
                </div>
                <div className="r-row">
                  <input className="r-field r-fill" placeholder="Message" aria-label="Message" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && transmit()} />
                  <button className="r-btn" style={{ width: 96 }} disabled={!canTransmit} onClick={transmit}>Transmit</button>
                </div>
              </div>
              <div className="r-log r-log--wrap" ref={radioRef} style={{ height: 140 }}>
                {state.radio.map((m) => (
                  <div className="r-log__line" key={m.id}>
                    {new Date(m.at).toLocaleTimeString("en-GB")} {m.to === "all" ? "ALL" : m.to.map((i) => byId(i)?.name ?? "?").join(", ")}: {m.text}
                  </div>
                ))}
              </div>
            </div>

            <button className="r-btn" onClick={() => setDialog({ kind: "rules" })}>Penalty rules</button>

            <div className="r-panel">
              <div className="r-header">Audit log</div>
              <div className="r-log r-log--wrap" ref={logRef} style={{ height: 260 }}>
                {state.log.map((l, i) => (
                  <div className="r-log__line is-dim" key={i}>
                    {new Date(l.at).toLocaleTimeString("en-GB")} {l.actor}: {l.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="r-statusbar">
        {live ? <div className="r-lamp r-lamp--fixed">LIVE</div> : <div className="r-lamp r-lamp--fixed r-lamp--red is-blink">OFF</div>}
        <span>{queued.length} queued</span>
        <span>{onTrack.length} on track</span>
        <span className="r-statusbar__end">{VERSION}</span>
      </div>

      {dialog?.kind === "reset" && <ConfirmReset onClose={closeDialog} send={send} />}
      {dialog?.kind === "rules" && <RulesDialog state={state} onClose={closeDialog} send={send} />}
      {dialog?.kind === "penalty" && dialogRun && <PenaltyDialog run={dialogRun} state={state} onClose={closeDialog} send={send} />}
      {dialog?.kind === "dnf" && dialogRun && <ConfirmDnf run={dialogRun} onClose={closeDialog} send={send} />}
      {dialog?.kind === "recipients" && (
        <RecipientsDialog
          runs={state.runs}
          selected={to === "all" ? [] : to}
          onClose={closeDialog}
          onConfirm={(ids) => {
            setTo(ids);
            closeDialog();
          }}
        />
      )}
      {dialog?.kind === "assign" && (
        <AssignDialog
          ts={dialog.ts}
          cars={onTrack.filter((r: Run) => r.startedAt! <= dialog.ts)}
          onClose={closeDialog}
          send={send}
        />
      )}
    </div>
  );
}
