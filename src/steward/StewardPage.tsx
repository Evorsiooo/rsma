import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Command } from "../../shared/commands";
import { classify, fmtPenalty, fmtTime, type Flag, type Run } from "../../shared/race";
import type { RaceSummary, Team } from "../../shared/types";
import { api, raceAccess, sendCommand } from "../api";
import { ClassificationTable } from "../ClassificationTable";
import { useMe } from "../me";
import { NotFound } from "../NotFound";
import { Topbar } from "../Shell";
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

function Lcd({ value, h, ghost = 0, label }: { value: string; h: number; ghost?: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (window as unknown as { RSMA: { lcd: (el: HTMLElement, v: string, o: object) => void } }).RSMA.lcd(ref.current!, value, {
      h,
      skew: -4,
      ghost,
      label,
    });
  }, [value, h, ghost, label]);
  return <div className="r-lcd" ref={ref} />;
}

const FLAG_WORD: Record<Flag, string> = { green: "GREEN", yellow: "YELLOW", red: "RED" };
const STATUS_TEXT = { queued: "Queued", onstage: "On stage", finished: "Finished", dnf: "DNF" } as const;
const STATUS_COLOR = {
  queued: "var(--r-text-dim)",
  onstage: "var(--r-yellow)",
  finished: "var(--r-green)",
  dnf: "var(--r-red)",
} as const;

function Panel({ raceId, race }: { raceId: string; race: RaceSummary }) {
  const nav = useNavigate();
  const { state, live, offset } = useRaceLive(raceId, true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [to, setTo] = useState<string[] | "all">("all");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [sort, setSort] = useState<"fastest" | "last">("fastest");
  useEffect(() => {
    api.teams().then(setTeams, () => {});
  }, []);
  const closeDialog = () => setDialog(null);
  const now = useNow(offset, !!state && (state.runs.some((r) => r.status === "onstage") || !!state.lastReleaseAt));

  const send = async (cmd: Command) => {
    const err = await sendCommand(raceId, cmd);
    if (err) toast(ERRORS[err] ?? "Command failed.");
    return !err;
  };

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state?.log.length]);

  const rows = useMemo(() => {
    if (!state) return [];
    const ranked = classify(state.runs);
    if (sort === "fastest") return ranked;
    // Last run: most recently started first, queued drivers after in entry order.
    const started = ranked.filter((r) => r.startedAt != null).sort((a, b) => b.startedAt! - a.startedAt!);
    return [...started, ...ranked.filter((r) => r.startedAt == null)];
  }, [state, sort]);
  if (!state) return <div className="r-screen" />;

  const queued = state.runs.filter((r) => r.status === "queued");
  const onTrack = state.runs.filter((r) => r.status === "onstage");
  const byId = (id: string) => state.runs.find((r) => r.id === id);
  const next = queued[0];
  const counting = onTrack.filter((r) => r.startedAt! > now);
  const releaseLeft = state.lastReleaseAt ? Math.max(0, state.lastReleaseAt + state.cadenceSec * 1000 - now) : null;
  const sel = selId ? byId(selId) : undefined;
  const bestFinal = rows.reduce<number | undefined>((m, r) => (r.finalMs != null && (m == null || r.finalMs < m) ? r.finalMs : m), undefined);
  const selIndex = sel ? queued.indexOf(sel) : -1;
  const radioTarget = to === "all" ? "all" : to.filter((i) => byId(i));
  const canTransmit = text.trim() !== "" && (radioTarget === "all" || radioTarget.length > 0);
  const dialogRun = dialog && "runId" in dialog ? byId(dialog.runId) : undefined;
  const fmtMMSS = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  const transmit = async () => {
    if (!canTransmit) return;
    if (await send({ type: "radio", to: radioTarget, text })) setText("");
  };
  const stage = async () => {
    if (!name.trim() || !plate.trim()) return;
    const team = teams.find((t) => t.id === teamId);
    if (await send({ type: "add", name, plate, team })) {
      setName("");
      setPlate("");
    }
  };

  return (
    <div className="page">
      <Topbar>
        <span className="r-text r-text--dim">{race.name}</span>
        <button className="r-btn" onClick={() => nav(`/race/${raceId}`)}>Timing</button>
      </Topbar>
      <div className="r-stack" style={{ flex: "1 1 0", minHeight: 0, padding: 4, gap: 4 }}>
        <div className="r-row" style={{ height: 90, flex: "none" }}>
          <div className="r-module" style={{ width: 84 }}>
            <div className="r-header">Link</div>
            <div className="r-module__well r-module__well--bare">
              {live ? <div className="r-lamp r-lamp--fixed">LIVE</div> : <div className="r-lamp r-lamp--fixed r-lamp--red is-blink">OFF</div>}
            </div>
          </div>
          <div className="r-module" style={{ width: 170 }}>
            <div className="r-header">Next release</div>
            <div className="r-module__well">
              <Lcd value={releaseLeft == null ? "--:--" : fmtMMSS(releaseLeft)} h={36} label="Time to next release" />
            </div>
          </div>
          <div className="r-module" style={{ width: 76 }}>
            <div className="r-header">On track</div>
            <div className="r-module__well"><Lcd value={String(onTrack.length)} h={32} ghost={1} label="Cars on track" /></div>
          </div>
          <div className="r-module" style={{ width: 76 }}>
            <div className="r-header">Queued</div>
            <div className="r-module__well"><Lcd value={String(queued.length)} h={32} ghost={1} label="Cars queued" /></div>
          </div>
          <div className="r-module r-fill">
            <div className="r-header">Pending finish</div>
            <div className="r-module__well">
              <div className="r-blank r-stack" style={{ padding: 2, gap: 2, overflow: "auto" }}>
                {state.pending.map((ts) => (
                  <div className="r-row" style={{ alignItems: "center", gap: 4 }} key={ts}>
                    <span className="r-text r-fill" style={{ paddingLeft: 4 }}>{new Date(ts).toLocaleTimeString("en-GB")}</span>
                    <button className="r-cell r-cell--wide" style={{ height: 19 }} onClick={() => setDialog({ kind: "assign", ts })}>Assign</button>
                    <button className="r-cell r-cell--wide" style={{ height: 19 }} onClick={() => send({ type: "discard", ts })}>Discard</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="r-row" style={{ height: 42, flex: "none" }}>
          <button className="r-btn r-btn--advance" style={{ width: 112 }} disabled={!next} onClick={() => send({ type: "go" })}>
            <span>Go</span>
          </button>
          <div className={`r-plate is-${state.flag}`} style={{ width: 120 }}>{FLAG_WORD[state.flag]}</div>
          <div className="r-plate r-fill">
            {counting.length > 0 ? Math.ceil((counting[0].startedAt! - now) / 1000) : next ? `${next.name}  ${next.plate}` : ""}
          </div>
          <button className="r-btn r-btn--advance" style={{ width: 150 }} onClick={() => send({ type: "finish" })}>
            <span>Stop timer</span>
          </button>
        </div>

        <div className="r-row" style={{ flex: "1 1 0", minHeight: 0 }}>
          <div className="r-stack" style={{ width: 300, padding: "0 6px", flex: "none", overflow: "auto" }}>
            <div className="r-section"><span>Flags</span></div>
            <div className="r-grid" style={{ ["--cols" as string]: 3 }}>
              {(["green", "yellow", "red"] as Flag[]).map((f) => (
                <button key={f} className="r-btn" aria-pressed={state.flag === f} onClick={() => state.flag !== f && send({ type: "flag", flag: f })}>
                  {f}
                </button>
              ))}
            </div>
            <div className="r-section"><span>Release every</span></div>
            <div className="r-row">
              <div className="r-stepper r-fill">
                <button className="r-cell" aria-label="Less" onClick={() => send({ type: "cadence", sec: Math.max(5, state.cadenceSec - 5) })}>-</button>
                <div className="r-readout r-fill">{state.cadenceSec}s</div>
                <button className="r-cell" aria-label="More" onClick={() => send({ type: "cadence", sec: Math.min(600, state.cadenceSec + 5) })}>+</button>
              </div>
            </div>
            <div className="r-grid" style={{ ["--cols" as string]: 4 }}>
              {PRESETS.map((p) => (
                <button key={p} className="r-btn" aria-pressed={state.cadenceSec === p} onClick={() => send({ type: "cadence", sec: p })}>
                  {p}
                </button>
              ))}
            </div>
            <div className="r-section"><span>Staging</span></div>
            <input className="r-field" placeholder="Driver" aria-label="Driver name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && stage()} />
            <div className="r-select">
              <select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Independent</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="r-row">
              <input className="r-field r-fill" placeholder="Plate" aria-label="Plate" value={plate} onChange={(e) => setPlate(e.target.value)} onKeyDown={(e) => e.key === "Enter" && stage()} />
              <button className="r-btn" style={{ width: 100 }} disabled={!name.trim() || !plate.trim()} onClick={stage}>Stage</button>
            </div>
            <div className="r-section"><span>Sort</span></div>
            <div className="r-grid" style={{ ["--cols" as string]: 2 }}>
              <button className="r-btn" aria-pressed={sort === "fastest"} onClick={() => setSort("fastest")}>Fastest</button>
              <button className="r-btn" aria-pressed={sort === "last"} onClick={() => setSort("last")}>Last run</button>
            </div>
            <div className="r-section"><span>Stage</span></div>
            <div className="r-grid" style={{ ["--cols" as string]: 2 }}>
              <button className="r-btn" onClick={() => setDialog({ kind: "rules" })}>Rules</button>
              <button className="r-btn" onClick={() => setDialog({ kind: "reset" })}>Reset</button>
            </div>
          </div>

          <div className="r-stack r-fill">
            <div className="r-panel r-fill" style={{ overflow: "auto" }}>
              <table className="r-table">
                <thead>
                  <tr>
                    <th className="is-left" style={{ width: 36 }}>P</th>
                    <th className="is-left">Driver</th>
                    <th className="is-left" style={{ width: 90 }}>Plate</th>
                    <th className="is-left" style={{ width: 130 }}>Team</th>
                    <th className="is-left" style={{ width: 90 }}>Status</th>
                    <th style={{ width: 100 }}>Time</th>
                    <th style={{ width: 90 }}>Pen</th>
                    <th style={{ width: 100 }}>Final</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={r.id === selId ? "is-selected" : ""}
                      style={{ cursor: "pointer" }}
                      tabIndex={0}
                      aria-selected={r.id === selId}
                      onClick={() => setSelId(r.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelId(r.id)}
                    >
                      <td className="is-left" style={{ color: "var(--r-teal)" }}>{r.rank ?? ""}</td>
                      <td className="is-left">{r.name}</td>
                      <td className="is-left" style={{ color: "var(--r-red)" }}>{r.plate}</td>
                      <td className="is-left" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.teamName ?? ""}</td>
                      <td className="is-left" style={{ color: STATUS_COLOR[r.status] }}>{STATUS_TEXT[r.status]}</td>
                      <td style={{ color: "var(--r-yellow)" }}>
                        {r.status === "onstage" ? (r.startedAt! > now ? "" : fmtLive(now - r.startedAt!)) : r.rawMs != null ? fmtTime(r.rawMs) : ""}
                      </td>
                      <td className={r.penaltyMs ? "is-red" : ""}>{r.penaltyMs ? fmtPenalty(r.penaltyMs) : ""}</td>
                      <td style={{ color: r.finalMs != null ? (r.finalMs === bestFinal ? "var(--r-magenta)" : "var(--r-green)") : undefined }}>{r.finalMs != null ? fmtTime(r.finalMs) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="r-row" style={{ height: 200, flex: "none" }}>
              <div className="r-panel r-fill">
                <div className="r-header">Race log</div>
                <div className="r-log r-log--wrap" ref={logRef} style={{ flex: "1 1 0", minHeight: 0 }}>
                  {state.log.map((l, i) => (
                    <div className={`r-log__line${l.tone ? ` is-${l.tone}` : ""}`} key={i}>
                      {new Date(l.at).toLocaleTimeString("en-GB")} {l.actor}: {l.text}
                    </div>
                  ))}
                </div>
                <div className="r-header">Radio message</div>
                <input className="r-field" style={{ width: "100%" }} aria-label="Radio message" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && transmit()} />
                <div className="r-grid" style={{ ["--cols" as string]: 3 }}>
                  <button className={`r-cell${to === "all" ? " is-on" : ""}`} aria-pressed={to === "all"} onClick={() => setTo("all")}>All drivers</button>
                  <button className={`r-cell${to !== "all" ? " is-on" : ""}`} aria-pressed={to !== "all"} onClick={() => setDialog({ kind: "recipients" })}>
                    {to === "all" ? "Selected" : `Selected (${radioTarget.length})`}
                  </button>
                  <button className="r-cell" disabled={!canTransmit} onClick={transmit}>Transmit</button>
                </div>
              </div>

              <div className="r-panel" style={{ width: 220 }}>
                <div className="r-header">Selected car</div>
                <div className="r-log r-log--title">{sel ? `${sel.name}  ${sel.plate}` : ""}</div>
                <div className="r-log" style={{ flex: "1 1 0", minHeight: 0 }}>
                  {sel?.penalties.map((p, i) => (
                    <div className="r-log__line is-red" key={i}>{fmtPenalty(p.ms)} {p.name}</div>
                  ))}
                </div>
                <div className="r-grid" style={{ ["--cols" as string]: 3 }}>
                  {sel?.status === "queued" && (
                    <>
                      <button className="r-cell" disabled={selIndex === 0} onClick={() => send({ type: "move", runId: sel.id, dir: -1 })}>Up</button>
                      <button className="r-cell" disabled={selIndex === queued.length - 1} onClick={() => send({ type: "move", runId: sel.id, dir: 1 })}>Down</button>
                      <button className="r-cell r-cell--red" onClick={() => send({ type: "remove", runId: sel.id })}>Remove</button>
                    </>
                  )}
                  {sel?.status === "onstage" && (
                    <>
                      <button className="r-cell" onClick={() => setDialog({ kind: "penalty", runId: sel.id })}>Penalty</button>
                      <button className="r-cell r-cell--red" onClick={() => setDialog({ kind: "dnf", runId: sel.id })}>DNF</button>
                      <button className="r-cell" disabled={sel.startedAt! > now} onClick={() => send({ type: "finish", runId: sel.id })}>Finish</button>
                    </>
                  )}
                  {sel?.status === "finished" && <button className="r-cell" onClick={() => setDialog({ kind: "penalty", runId: sel.id })}>Penalty</button>}
                </div>
              </div>
            </div>
          </div>
        </div>
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
        <AssignDialog ts={dialog.ts} cars={onTrack.filter((r: Run) => r.startedAt! <= dialog.ts)} onClose={closeDialog} send={send} />
      )}
    </div>
  );
}
