import {
  COUNTDOWN_MS,
  fmtPenalty,
  type Flag,
  type RaceState,
  type Run,
} from "./race.ts";

export type Command =
  | { type: "flag"; flag: Flag }
  | { type: "add"; name: string; plate: string }
  | { type: "remove"; runId: string }
  | { type: "move"; runId: string; dir: -1 | 1 }
  | { type: "go" }
  | { type: "cadence"; sec: number }
  | { type: "finish"; runId?: string }
  | { type: "assign"; ts: number; runId: string }
  | { type: "discard"; ts: number }
  | { type: "dnf"; runId: string }
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
const MAX_RADIO = 100;

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const validSeconds = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 600;

/** Pure reducer: applies one steward command. Never mutates the input state. */
export function applyCommand(prev: RaceState, cmd: Command, ctx: Ctx): Result {
  const s: RaceState = structuredClone(prev);
  const note = (text: string) => {
    s.log.push({ at: ctx.now, actor: ctx.actor, text });
    if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
  };
  const run = (id: string): Run | undefined => s.runs.find((r) => r.id === id);
  const recompute = (r: Run) => (r.penaltyMs = r.penalties.reduce((a, p) => a + p.ms, 0));
  const running = () => s.runs.filter((r) => r.status === "onstage");

  switch (cmd.type) {
    case "flag": {
      if (!["green", "yellow", "red"].includes(cmd.flag)) return { error: "invalid" };
      s.flag = cmd.flag;
      note(`Flag ${cmd.flag}`);
      break;
    }
    case "add": {
      const name = clean(cmd.name, 40);
      const plate = clean(cmd.plate, 12).toUpperCase();
      if (!name || !plate) return { error: "invalid" };
      s.runs.push({ id: ctx.newId(), name, plate, status: "queued", penalties: [], penaltyMs: 0 });
      note(`Staged ${name} (${plate})`);
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
        target = started.sort((a, b) => a.startedAt! - b.startedAt!)[0];
      }
      if (!target) {
        s.pending.push(ctx.now);
        note("Finish line crossed, no car to attribute");
        break;
      }
      target.status = "finished";
      target.rawMs = ctx.now - target.startedAt!;
      note(`Finish: ${target.name}`);
      break;
    }
    case "assign": {
      if (!s.pending.includes(cmd.ts)) return { error: "not_found" };
      const r = running().find((x) => x.id === cmd.runId && x.startedAt != null && x.startedAt <= cmd.ts);
      if (!r) return { error: "not_running" };
      r.status = "finished";
      r.rawMs = cmd.ts - r.startedAt!;
      s.pending = s.pending.filter((t) => t !== cmd.ts);
      note(`Finish attributed to ${r.name}`);
      break;
    }
    case "discard": {
      if (!s.pending.includes(cmd.ts)) return { error: "not_found" };
      s.pending = s.pending.filter((t) => t !== cmd.ts);
      note("Pending finish discarded");
      break;
    }
    case "dnf": {
      const r = run(cmd.runId);
      if (!r) return { error: "not_found" };
      if (r.status !== "onstage") return { error: "not_running" };
      r.status = "dnf";
      note(`DNF: ${r.name}`);
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
        note(`${fmtPenalty(rule.seconds * 1000)} ${rule.name} to ${r.name}`);
      } else {
        const idx = r.penalties.map((p) => p.ruleId).lastIndexOf(cmd.ruleId);
        if (idx < 0) return { error: "not_found" };
        const [p] = r.penalties.splice(idx, 1);
        recompute(r);
        note(`Removed ${p.name} from ${r.name}`);
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
      s.radio.push({ id: ctx.newId(), at: ctx.now, to: cmd.to, text, from: ctx.actor });
      note(`Radio to ${cmd.to === "all" ? "all drivers" : cmd.to.map((i) => run(i)!.name).join(", ")}: ${text}`);
      if (s.radio.length > MAX_RADIO) s.radio.splice(0, s.radio.length - MAX_RADIO);
      break;
    }
    case "reset": {
      // Times, penalties, pending finishes and radio history are cleared; drivers still queued stay.
      s.runs = s.runs.filter((r) => r.status === "queued");
      s.pending = [];
      s.radio = [];
      s.lastReleaseAt = undefined;
      note("Stage reset");
      break;
    }
    default:
      return { error: "invalid" };
  }
  return { state: s };
}
