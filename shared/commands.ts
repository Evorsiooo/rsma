import {
  COUNTDOWN_MS,
  classify,
  fmtPenalty,
  fmtTime,
  spokenTime,
  type Flag,
  type RaceState,
  type Run,
  type Tone,
} from "./race.ts";

export type Command =
  | { type: "flag"; flag: Flag }
  | { type: "add"; name: string; plate: string; number?: string; team?: { id: string; name: string; car?: string } }
  | { type: "teamMove"; team: string; runId: string; dir: -1 | 1 }
  | { type: "teamRadio"; team: string; teamName: string; text: string; to?: "team" | "stewards" }
  | { type: "ask"; team: string; teamName: string; driver: string; text: string; options?: string[] }
  | { type: "answer"; msgId: string; index: number }
  | { type: "driverRadio"; text: string }
  | { type: "radioTeams"; teams: { id: string; name: string }[]; text: string }
  | { type: "note"; runId: string; text: string }
  | { type: "noteDel"; id: string }
  | { type: "teamNote"; team: string; runId: string; text: string }
  | { type: "teamNoteDel"; team: string; id: string }
  | { type: "pitAdd"; team: string; teamName: string; fromMs: number; toMs: number; lengthMs: number }
  | { type: "pitDel"; team: string; id: string }
  | { type: "syncReg"; drivers: { name: string; team?: { id: string; name: string; car?: string } }[] }
  | { type: "remove"; runId: string }
  | { type: "move"; runId: string; dir: -1 | 1 }
  | { type: "go" }
  | { type: "teamGo"; team: string }
  | { type: "teamFinish"; team: string; runId?: string }
  | { type: "delRun"; runId: string }
  | { type: "cadence"; sec: number }
  | { type: "finish"; runId?: string }
  | { type: "setMode"; runId: string; mode: "quali" | "long"; team?: string }
  | { type: "lap"; runId: string; team?: string }
  | { type: "assign"; ts: number; runId: string; team?: string }
  | { type: "unattribute"; runId: string; team?: string }
  | { type: "reattribute"; fromRunId: string; runId: string; team?: string }
  | { type: "setTime"; runId: string; ms: number; team?: string }
  | { type: "editInfo"; runId: string; plate: string; number?: string }
  | { type: "discard"; ts: number }
  | { type: "dnf"; runId: string; team?: string }
  | { type: "undnf"; runId: string; team?: string }
  | { type: "penalty"; runId: string; ruleId: string; delta: 1 | -1 }
  | { type: "ruleAdd"; name: string; seconds: number }
  | { type: "ruleSet"; id: string; seconds: number }
  | { type: "ruleDel"; id: string }
  | { type: "radio"; to: "all" | string[]; text: string }
  | { type: "reset" };

export interface Ctx {
  now: number;
  actor: string;
  newId: () => string;
}

export type Result = { state: RaceState } | { error: string };

const MAX_LOG = 200;
const MAX_RADIO = 300;

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const validSeconds = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 600;

/** Pure reducer: applies one steward command. Never mutates the input state. */
export function applyCommand(prev: RaceState, cmd: Command, ctx: Ctx): Result {
  const s: RaceState = structuredClone(prev);
  const note = (text: string, tone?: Tone) => {
    s.log.push({ at: ctx.now, actor: ctx.actor, text, tone });
    if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
  };
  s.notes ??= [];
  s.pitWindows ??= [];
  const auto = (to: "all" | string[], text: string, say?: string, tone?: Tone) => {
    s.radio.push({ id: ctx.newId(), at: ctx.now, to, text, say, from: "Race control", auto: true, tone });
  };
  const run = (id: string): Run | undefined => s.runs.find((r) => r.id === id);
  const recompute = (r: Run) => (r.penaltyMs = r.penalties.reduce((a, p) => a + p.ms, 0));
  /** Finish a car: its elapsed time, or for a long run its best lap (the final lap counts). */
  const complete = (r: Run) => {
    if (r.mode === "long") {
      const last = ctx.now - (r.lapAt ?? r.startedAt!);
      if (last >= 1000 || !r.laps?.length) (r.laps ??= []).push(last);
      r.rawMs = Math.min(...r.laps!);
    } else {
      r.rawMs = ctx.now - r.startedAt!;
    }
    r.status = "finished";
  };
  const running = () => s.runs.filter((r) => r.status === "onstage");

  switch (cmd.type) {
    case "flag": {
      if (!["green", "yellow", "red"].includes(cmd.flag)) return { error: "invalid" };
      if (s.flag !== cmd.flag) auto("all", `${cmd.flag[0].toUpperCase()}${cmd.flag.slice(1)} flag.`, undefined, cmd.flag);
      s.flag = cmd.flag;
      note(`Flag ${cmd.flag}`, "yellow");
      break;
    }
    case "add": {
      const name = clean(cmd.name, 40);
      const plate = clean(cmd.plate, 12).toUpperCase();
      if (!name || !plate) return { error: "invalid" };
      const team = cmd.team && clean(cmd.team.id, 60) && clean(cmd.team.name, 40) ? { id: clean(cmd.team.id, 60), name: clean(cmd.team.name, 40) } : undefined;
      s.runs.push({ id: ctx.newId(), name, plate, status: "queued", penalties: [], penaltyMs: 0, number: clean(cmd.number, 4) || undefined, team: team?.id, teamName: team?.name, car: team ? clean(cmd.team?.car, 40) || undefined : undefined });
      note(`Staged ${name} (${plate})${team ? `, ${team.name}` : ""}`);
      break;
    }
    case "syncReg": {
      // Registered drivers who made the cut, one car each, kept in step with registration. Plate and number come later
      // through Edit info. Only cars staged from registration that are still queued are removed again.
      const want = new Map<string, NonNullable<(typeof cmd.drivers)[number]>>();
      for (const d of cmd.drivers ?? []) {
        const name = clean(d?.name, 40);
        if (name) want.set(name.toLowerCase(), d);
      }
      let added = 0;
      let removed = 0;
      s.runs = s.runs.filter((r) => {
        if (r.reg && r.status === "queued" && !want.has(r.name.toLowerCase())) {
          removed++;
          return false;
        }
        return true;
      });
      const have = new Set(s.runs.map((r) => r.name.toLowerCase()));
      for (const [key, d] of want) {
        if (have.has(key)) continue;
        const team = d.team && clean(d.team.id, 60) && clean(d.team.name, 40) ? { id: clean(d.team.id, 60), name: clean(d.team.name, 40) } : undefined;
        s.runs.push({ id: ctx.newId(), name: clean(d.name, 40), plate: "", reg: true, status: "queued", penalties: [], penaltyMs: 0, team: team?.id, teamName: team?.name, car: team ? clean(d.team?.car, 40) || undefined : undefined });
        added++;
      }
      if (!added && !removed) return { error: "nothing_to_add" };
      if (added) note(`${added} driver${added === 1 ? "" : "s"} staged from registration`);
      if (removed) note(`${removed} driver${removed === 1 ? "" : "s"} removed from the queue by registration`);
      break;
    }
    case "remove": {
      const r = run(cmd.runId);
      if (!r) return { error: "not_found" };
      if (r.status !== "queued") return { error: "not_queued" };
      s.runs = s.runs.filter((x) => x !== r);
      note(`Removed ${r.name} from the queue`);
      break;
    }
    case "move": {
      const queued = s.runs.filter((r) => r.status === "queued");
      const i = queued.findIndex((r) => r.id === cmd.runId);
      const j = i + cmd.dir;
      if (i < 0) return { error: "not_found" };
      if (j < 0 || j >= queued.length) return { error: "invalid" };
      const a = s.runs.indexOf(queued[i]);
      const b = s.runs.indexOf(queued[j]);
      [s.runs[a], s.runs[b]] = [s.runs[b], s.runs[a]];
      break;
    }
    case "go": {
      const next = s.runs.find((r) => r.status === "queued");
      if (!next) return { error: "no_queue" };
      next.status = "onstage";
      next.startedAt = ctx.now + COUNTDOWN_MS;
      s.lastReleaseAt = ctx.now;
      note(`Released ${next.name}`);
      break;
    }
    case "ask": {
      const text = clean(cmd.text, 200);
      const team = clean(cmd.team, 60);
      const driver = clean(cmd.driver, 40).toLowerCase();
      const mine = s.runs.filter((r) => r.team === team && r.name.toLowerCase() === driver);
      const target = mine.find((r) => r.status === "onstage") ?? mine.find((r) => r.status === "queued") ?? mine[mine.length - 1];
      if (!text || !target) return { error: "invalid" };
      const options = Array.isArray(cmd.options) ? cmd.options.map((o) => clean(o, 40)).filter(Boolean).slice(0, 4) : [];
      if (Array.isArray(cmd.options) && cmd.options.length > 0 && options.length < 2) return { error: "invalid" };
      const yesNo = options.length === 0;
      const opts = yesNo ? ["Yes", "No"] : options;
      const say = yesNo ? text : `${text} ${opts.map((o, i) => `Option ${i + 1}: ${o}.`).join(" ")}`;
      s.radio.push({ id: ctx.newId(), at: ctx.now, to: [target.id], team, teamName: clean(cmd.teamName, 40), text, say, from: ctx.actor, ask: { options: opts, yesNo } });
      if (s.radio.length > MAX_RADIO) s.radio.splice(0, s.radio.length - MAX_RADIO);
      note(`Question to ${target.name}, ${clean(cmd.teamName, 40) || team}: ${text}`, "teal");
      break;
    }
    case "answer": {
      const m = s.radio.find((x) => x.id === cmd.msgId && x.ask);
      if (!m || !m.ask || !Array.isArray(m.to)) return { error: "not_found" };
      if (!s.runs.some((r) => (m.to as string[]).includes(r.id) && r.name.toLowerCase() === ctx.actor.toLowerCase())) return { error: "forbidden" };
      if (m.ask.answered) return { error: "answered" };
      if (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index >= m.ask.options.length) return { error: "invalid" };
      m.ask.answered = { index: cmd.index, at: ctx.now };
      const label = m.ask.options[cmd.index];
      s.radio.push({
        id: ctx.newId(),
        at: ctx.now,
        to: "team",
        team: m.team,
        teamName: m.teamName,
        text: `${label}, to "${m.text}"`,
        from: ctx.actor,
        tone: m.ask.yesNo ? (cmd.index === 0 ? "green" : "red") : undefined,
      });
      note(`${ctx.actor} answered "${label}" to "${m.text}"`, "teal");
      break;
    }
    case "driverRadio": {
      const text = clean(cmd.text, 200);
      const mine = s.runs.filter((r) => r.name.toLowerCase() === ctx.actor.toLowerCase() && r.team);
      const r = mine.find((x) => x.status === "onstage") ?? mine.find((x) => x.status === "queued") ?? mine[mine.length - 1];
      if (!text) return { error: "invalid" };
      if (!r) return { error: "no_team" };
      s.radio.push({ id: ctx.newId(), at: ctx.now, to: "team", team: r.team, teamName: r.teamName, text, from: ctx.actor });
      if (s.radio.length > MAX_RADIO) s.radio.splice(0, s.radio.length - MAX_RADIO);
      note(`${ctx.actor} to ${r.teamName ?? r.team}: ${text}`, "teal");
      break;
    }
    case "teamMove": {
      const r = run(cmd.runId);
      if (!r || r.team !== cmd.team) return { error: "not_found" };
      if (r.status !== "queued") return { error: "not_queued" };
      const mine = s.runs.filter((x) => x.status === "queued" && x.team === cmd.team);
      const i = mine.indexOf(r);
      const j = i + cmd.dir;
      if (cmd.dir !== -1 && cmd.dir !== 1) return { error: "invalid" };
      if (j < 0 || j >= mine.length) return { error: "invalid" };
      // Swap with the neighbouring car of the same team; other teams' places in the queue do not change.
      const a = s.runs.indexOf(mine[i]);
      const b = s.runs.indexOf(mine[j]);
      [s.runs[a], s.runs[b]] = [s.runs[b], s.runs[a]];
      break;
    }
    case "teamGo": {
      const next = s.runs.find((r) => r.status === "queued" && r.team === cmd.team);
      if (!next) return { error: "no_queue" };
      next.status = "onstage";
      next.startedAt = ctx.now + COUNTDOWN_MS;
      s.lastReleaseAt = ctx.now;
      note(`Released ${next.name} (self-timed)`);
      break;
    }
    case "teamFinish": {
      const started = running().filter((r) => r.team === cmd.team && r.startedAt != null && r.startedAt <= ctx.now);
      // The generic stop is for Quali cars; a long run car is stopped by name.
      const target = cmd.runId ? started.find((r) => r.id === cmd.runId) : started.filter((r) => r.mode !== "long").sort((a, b) => a.startedAt! - b.startedAt!)[0];
      if (!target) return { error: "not_running" };
      complete(target);
      note(`Finish: ${target.name} (self-timed)`, "green");
      break;
    }
    case "delRun": {
      const r = run(cmd.runId);
      if (!r) return { error: "not_found" };
      if (r.status !== "finished" && r.status !== "dnf") return { error: "not_finished" };
      s.runs = s.runs.filter((x) => x !== r);
      note(`Deleted the time of ${r.name}`, "red");
      break;
    }
    case "cadence": {
      if (!Number.isInteger(cmd.sec) || cmd.sec < 5 || cmd.sec > 600) return { error: "invalid" };
      s.cadenceSec = cmd.sec;
      break;
    }
    case "finish": {
      const started = running().filter((r) => r.startedAt != null && r.startedAt <= ctx.now);
      let target: Run | undefined;
      if (cmd.runId) {
        target = started.find((r) => r.id === cmd.runId);
        if (!target) return { error: "not_running" };
      } else {
        target = started.filter((r) => r.mode !== "long").sort((a, b) => a.startedAt! - b.startedAt!)[0];
      }
      if (!target) {
        s.pending.push(ctx.now);
        note("Finish line crossed, no car to attribute", "yellow");
        break;
      }
      complete(target);
      note(`Finish: ${target.name}`, "green");
      break;
    }
    case "setMode": {
      const r = run(cmd.runId);
      if (!r || (cmd.team && r.team !== cmd.team)) return { error: "not_found" };
      if (cmd.mode !== "quali" && cmd.mode !== "long") return { error: "invalid" };
      if (r.status !== "queued" && r.status !== "onstage") return { error: "invalid" };
      if (cmd.mode === "quali" && r.laps?.length) return { error: "has_laps" };
      r.mode = cmd.mode;
      note(`${r.name}: ${cmd.mode === "long" ? "long run" : "quali"} mode`);
      break;
    }
    case "lap": {
      const r = run(cmd.runId);
      if (!r || (cmd.team && r.team !== cmd.team)) return { error: "not_found" };
      if (r.mode !== "long" || r.status !== "onstage" || r.startedAt == null || r.startedAt > ctx.now) return { error: "not_running" };
      const last = ctx.now - (r.lapAt ?? r.startedAt);
      if (last < 1000) return { error: "too_soon" }; // a double press
      (r.laps ??= []).push(last);
      r.lapAt = ctx.now;
      note(`Lap ${r.laps.length}: ${r.name} ${fmtTime(last)}`, "green");
      break;
    }
    case "assign": {
      if (!s.pending.includes(cmd.ts)) return { error: "not_found" };
      if (cmd.team && s.pendingTeam?.[cmd.ts] !== cmd.team) return { error: "forbidden" };
      const r = running().find((x) => x.id === cmd.runId && x.startedAt != null && x.startedAt <= cmd.ts && (!cmd.team || x.team === cmd.team));
      if (!r) return { error: "not_running" };
      r.status = "finished";
      r.rawMs = cmd.ts - r.startedAt!;
      s.pending = s.pending.filter((t) => t !== cmd.ts);
      if (s.pendingTeam) delete s.pendingTeam[cmd.ts];
      note(`Finish attributed to ${r.name}`, "green");
      break;
    }
    case "unattribute": {
      // Take a time off a car (a wrong stop): it becomes a pending finish that can be attributed to the right car.
      const r = run(cmd.runId);
      if (!r || (cmd.team && r.team !== cmd.team)) return { error: "not_found" };
      if (r.status !== "finished" || r.startedAt == null || r.rawMs == null || r.mode === "long") return { error: "invalid" };
      const ts = r.startedAt + r.rawMs;
      r.status = "onstage";
      delete r.rawMs;
      s.pending.push(ts);
      if (r.team) (s.pendingTeam ??= {})[ts] = r.team;
      note(`Time removed from ${r.name}`, "yellow");
      break;
    }
    case "reattribute": {
      // Move a finish from one car to another.
      const from = run(cmd.fromRunId);
      const to = run(cmd.runId);
      if (!from || !to || from === to) return { error: "not_found" };
      if (cmd.team && (from.team !== cmd.team || to.team !== cmd.team)) return { error: "not_found" };
      if (from.status !== "finished" || from.startedAt == null || from.rawMs == null || from.mode === "long") return { error: "invalid" };
      const ts = from.startedAt + from.rawMs;
      if (to.status !== "onstage" || to.startedAt == null || to.startedAt > ts) return { error: "not_running" };
      from.status = "onstage";
      delete from.rawMs;
      to.status = "finished";
      to.rawMs = ts - to.startedAt;
      note(`Time moved from ${from.name} to ${to.name}`, "yellow");
      break;
    }
    case "editInfo": {
      const r = run(cmd.runId);
      if (!r) return { error: "not_found" };
      const plate = clean(cmd.plate, 12).toUpperCase();
      if (!plate) return { error: "invalid" };
      r.plate = plate;
      r.number = clean(cmd.number, 4) || undefined;
      note(`Info updated for ${r.name}: ${plate}${r.number ? `, #${r.number}` : ""}`);
      break;
    }
    case "setTime": {
      const r = run(cmd.runId);
      if (!r || (cmd.team && r.team !== cmd.team)) return { error: "not_found" };
      if (!Number.isInteger(cmd.ms) || cmd.ms < 100 || cmd.ms > 86_400_000) return { error: "invalid" };
      r.status = "finished";
      r.rawMs = cmd.ms;
      note(`Time set for ${r.name}: ${fmtTime(cmd.ms)}`, "green");
      break;
    }
    case "discard": {
      if (!s.pending.includes(cmd.ts)) return { error: "not_found" };
      s.pending = s.pending.filter((t) => t !== cmd.ts);
      if (s.pendingTeam) delete s.pendingTeam[cmd.ts];
      note("Pending finish discarded");
      break;
    }
    case "dnf": {
      const r = run(cmd.runId);
      if (!r) return { error: "not_found" };
      if (cmd.team && r.team !== cmd.team) return { error: "not_found" };
      if (r.status !== "onstage") return { error: "not_running" };
      r.status = "dnf";
      note(`DNF: ${r.name}`, "red");
      break;
    }
    case "undnf": {
      // Takes the DNF back. The timer never stopped, so the run is on stage again with its original start.
      const r = run(cmd.runId);
      if (!r || (cmd.team && r.team !== cmd.team)) return { error: "not_found" };
      if (r.status !== "dnf" || r.startedAt == null) return { error: "not_dnf" };
      r.status = "onstage";
      note(`DNF withdrawn: ${r.name}`, "yellow");
      break;
    }
    case "penalty": {
      const r = run(cmd.runId);
      if (!r) return { error: "not_found" };
      if (r.status !== "onstage" && r.status !== "finished") return { error: "not_running" };
      const rule = s.rules.find((x) => x.id === cmd.ruleId);
      if (cmd.delta === 1) {
        if (!rule) return { error: "not_found" };
        r.penalties.push({ ruleId: rule.id, name: rule.name, ms: rule.seconds * 1000 });
        recompute(r);
        auto([r.id], `Penalty ${fmtPenalty(rule.seconds * 1000)}: ${rule.name}. Total penalties ${fmtPenalty(r.penaltyMs)}.`, `Penalty, ${rule.seconds} seconds, ${rule.name}. Total penalties ${r.penaltyMs / 1000} seconds.`, "red");
        note(`${fmtPenalty(rule.seconds * 1000)} ${rule.name} to ${r.name}`, "red");
      } else {
        const idx = r.penalties.map((p) => p.ruleId).lastIndexOf(cmd.ruleId);
        if (idx < 0) return { error: "not_found" };
        const [p] = r.penalties.splice(idx, 1);
        recompute(r);
        auto([r.id], `Penalty removed: ${p.name}. Total penalties ${fmtPenalty(r.penaltyMs)}.`, `Penalty removed, ${p.name}. Total penalties ${r.penaltyMs / 1000} seconds.`, "green");
        note(`Removed ${p.name} from ${r.name}`, "green");
      }
      break;
    }
    case "ruleAdd": {
      const name = clean(cmd.name, 40);
      if (!name || !validSeconds(cmd.seconds)) return { error: "invalid" };
      s.rules.push({ id: ctx.newId(), name, seconds: cmd.seconds });
      note(`Rule added: ${name} ${cmd.seconds}s`);
      break;
    }
    case "ruleSet": {
      const rule = s.rules.find((x) => x.id === cmd.id);
      if (!rule) return { error: "not_found" };
      if (!validSeconds(cmd.seconds)) return { error: "invalid" };
      rule.seconds = cmd.seconds;
      note(`Rule ${rule.name}: ${cmd.seconds}s`);
      break;
    }
    case "ruleDel": {
      const rule = s.rules.find((x) => x.id === cmd.id);
      if (!rule) return { error: "not_found" };
      s.rules = s.rules.filter((x) => x !== rule);
      note(`Rule removed: ${rule.name}`);
      break;
    }
    case "radio": {
      const text = clean(cmd.text, 200);
      if (!text) return { error: "invalid" };
      if (cmd.to !== "all" && (!Array.isArray(cmd.to) || cmd.to.length === 0 || !cmd.to.every((id) => !!run(id)))) {
        return { error: "invalid" };
      }
      s.radio.push({ id: ctx.newId(), at: ctx.now, to: cmd.to, text, from: ctx.actor, tone: "magenta" });
      note(`Radio to ${cmd.to === "all" ? "Global" : cmd.to.map((i) => run(i)!.name).join(", ")}: ${text}`, "magenta");
      if (s.radio.length > MAX_RADIO) s.radio.splice(0, s.radio.length - MAX_RADIO);
      break;
    }
    case "teamRadio": {
      const text = clean(cmd.text, 200);
      const team = clean(cmd.team, 60);
      if (!text || !team) return { error: "invalid" };
      const teamName = clean(cmd.teamName, 40);
      const toStewards = cmd.to === "stewards";
      s.radio.push({ id: ctx.newId(), at: ctx.now, to: toStewards ? "stewards" : "team", team, teamName, text, from: ctx.actor, tone: "teal" });
      note(`${toStewards ? "Team to stewards" : "Team radio"}, ${teamName || team}: ${text}`, "teal");
      break;
    }
    case "radioTeams": {
      const text = clean(cmd.text, 200);
      const teams = Array.isArray(cmd.teams) ? cmd.teams.filter((t) => clean(t?.id, 60) && clean(t?.name, 40)) : [];
      if (!text || !teams.length) return { error: "invalid" };
      for (const t of teams) {
        s.radio.push({ id: ctx.newId(), at: ctx.now, to: "team", team: clean(t.id, 60), teamName: clean(t.name, 40), text, from: ctx.actor, tone: "teal" });
      }
      note(`Radio to teams ${teams.map((t) => clean(t.name, 40)).join(", ")}: ${text}`, "teal");
      break;
    }
    case "note": {
      const r = run(cmd.runId);
      const text = clean(cmd.text, 500);
      if (!r) return { error: "not_found" };
      if (!text) return { error: "invalid" };
      s.notes.push({ id: ctx.newId(), at: ctx.now, by: ctx.actor, driver: r.name, text });
      break;
    }
    case "teamNote": {
      // A team writes about one of its own drivers.
      const r = run(cmd.runId);
      const text = clean(cmd.text, 500);
      if (!r || !r.team || r.team !== cmd.team) return { error: "not_found" };
      if (!text) return { error: "invalid" };
      s.notes.push({ id: ctx.newId(), at: ctx.now, by: ctx.actor, driver: r.name, text, team: r.team, teamName: r.teamName });
      break;
    }
    case "teamNoteDel": {
      if (!s.notes.some((n) => n.id === cmd.id && n.team === cmd.team)) return { error: "not_found" };
      s.notes = s.notes.filter((n) => n.id !== cmd.id);
      break;
    }
    case "noteDel": {
      if (!s.notes.some((n) => n.id === cmd.id)) return { error: "not_found" };
      s.notes = s.notes.filter((n) => n.id !== cmd.id);
      break;
    }
    case "pitAdd": {
      const team = clean(cmd.team, 60);
      const { fromMs, toMs, lengthMs } = cmd;
      if (!team || ![fromMs, toMs, lengthMs].every(Number.isFinite) || fromMs < 0 || toMs <= fromMs || toMs > lengthMs) return { error: "invalid" };
      if (s.pitWindows.filter((w) => w.team === team).length >= 20) return { error: "too_many" };
      s.pitWindows.push({ id: ctx.newId(), team, teamName: clean(cmd.teamName, 40), fromMs, toMs });
      s.pitWindows.sort((a, b) => a.fromMs - b.fromMs);
      note(`Pit window, ${clean(cmd.teamName, 40) || team}: ${fmtClockMs(fromMs)} to ${fmtClockMs(toMs)}`, "teal");
      break;
    }
    case "pitDel": {
      const w = s.pitWindows.find((x) => x.id === cmd.id && x.team === cmd.team);
      if (!w) return { error: "not_found" };
      s.pitWindows = s.pitWindows.filter((x) => x !== w);
      note(`Pit window removed, ${w.teamName || w.team}: ${fmtClockMs(w.fromMs)} to ${fmtClockMs(w.toMs)}`, "teal");
      break;
    }
    case "reset": {
      // Times, penalties, pending finishes and radio history are cleared; drivers still queued stay.
      s.runs = s.runs.filter((r) => r.status === "queued");
      s.pending = [];
      s.pendingTeam = {};
      s.radio = [];
      s.lastReleaseAt = undefined;
      note("Stage reset");
      break;
    }
    default:
      return { error: "invalid" };
  }
  announceResults(prev, s, auto);
  if (s.radio.length > MAX_RADIO) s.radio.splice(0, s.radio.length - MAX_RADIO);
  return { state: s };
}

/** Tell drivers what changed for them: their finish, a new position, a DNF. */
function announceResults(prev: RaceState, next: RaceState, auto: (to: string[], text: string, say?: string, tone?: Tone) => void) {
  const before = new Map(classify(prev.runs).map((r) => [r.id, r]));
  for (const r of classify(next.runs)) {
    const p = before.get(r.id);
    if (!p) continue;
    if (r.status === "finished" && p.status !== "finished" && r.rawMs != null && r.finalMs != null) {
      const pen = r.penaltyMs ? ` Penalties ${fmtPenalty(r.penaltyMs)}, final ${fmtTime(r.finalMs)}.` : "";
      const spokenPen = r.penaltyMs ? ` Penalties ${r.penaltyMs / 1000} seconds, final ${spokenTime(r.finalMs)}.` : "";
      auto([r.id], `Finished. Time ${fmtTime(r.rawMs)}.${pen} Position P${r.rank}.`, `Finished. Time ${spokenTime(r.rawMs)}.${spokenPen} Position ${r.rank}.`, "green");
    } else if (r.status === "finished" && p.status === "finished" && p.rank !== r.rank) {
      auto([r.id], `Position now P${r.rank}.`, `Position now ${r.rank}.`, (r.rank ?? 0) < (p.rank ?? 0) ? "green" : "yellow");
    } else if (r.status === "onstage" && p.status === "dnf") {
      auto([r.id], "DNF withdrawn. Timing continues.", undefined, "yellow");
    } else if (r.status === "dnf" && p.status !== "dnf") {
      auto([r.id], "Did not finish.", undefined, "red");
    }
  }
}

/** h:mm:ss or mm:ss, from milliseconds. */
function fmtClockMs(ms: number) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
