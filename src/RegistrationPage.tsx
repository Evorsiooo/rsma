import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CUT_LABEL, GROUP_URL, groupSummary, REG_KIND_LABEL, REG_KINDS, type RegKind, type RegistrationView, type RegTeam } from "../shared/registration";
import { PANEL_ROLES, hasAny } from "../shared/teams";
import type { SessionInfo } from "../shared/types";
import { api, registrationApi } from "./api";
import { NotFound } from "./NotFound";
import { Bd, Box } from "./site/parts";
import { StaffSection } from "./admin/RegistrationsTab";
import { toast } from "./ui";

const ERRORS: Record<string, string> = {
  not_open: "Registration is not open.",
  taken: "Already registered, by another team or as an independent.",
  not_member: "That person is not in this team.",
  wrong_role: "Drivers need the Driver role, employees a staff role.",
  no_such_roblox_user: "No Roblox user with that name.",
  lookup_failed: "Could not reach Roblox. Try again in a moment.",
  invalid: "Invalid value.",
  invalid_discord: "Enter your Discord username.",
  group_required: "Say whether you joined the group or your request is pending.",
  independents_closed: "Independent drivers cannot register for this session.",
  picks_closed: "The time to choose drivers for this session has passed.",
  too_many: "Too many drivers chosen for one team.",
  not_registered: "Only registered drivers of the team can be chosen.",
  forbidden: "Not allowed.",
};
const say = (e: string) => toast(ERRORS[e] ?? "Request failed.");

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

type Res = { ok: true } | { ok: false; error: string };

export function RegistrationPage() {
  const { id = "" } = useParams();
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
  if (!info || !view?.settings) return <Box title="Registration"><Bd><div className="note">Loading...</div></Bd></Box>;
  const s = view.settings;
  const open = view.phase === "open";
  const label = view.phase === "upcoming" ? `Opens ${fmt.format(s.opensAt)}` : open ? `Open until ${fmt.format(s.deadline)}` : "Closed";

  return (
    <>
      <div style={{ fontSize: 12 }} className="note">
        <b style={{ color: "var(--s-ink)" }}>{info.race.name} · {info.session.name} · team registration</b> · {label}
      </div>
      {view.group.length > 1 && (
        <div style={{ fontSize: 12 }} className="note">
          {groupSummary(view.group)?.teams} {groupSummary(view.group)?.independents} Removing someone removes them from all of them.
        </div>
      )}
      <Box title="Spots">
        <table className="kv">
          <tbody>
            {REG_KINDS.map((k) => (
              <tr key={k}>
                <td>{REG_KIND_LABEL[k]}s</td>
                <td>{view.counts[k].taken} / {view.counts[k].spots}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
      {view.teams.length === 0 ? (
        <Box title="Team Registration"><Bd><div className="note">Only a Team Principal or Sporting Director can register a team.</div></Bd></Box>
      ) : (
        view.teams.map((t) => <TeamSection key={t.id} team={t} view={view} open={open} sid={id} act={act} />)
      )}
      {view.staff && <StaffSection view={view} sid={id} act={act} />}
    </>
  );
}

function TeamSection({ team, view, open, sid, act }: { team: RegTeam; view: RegistrationView; open: boolean; sid: string; act: (p: Promise<Res>) => Promise<boolean> }) {
  const mine = view.registrations.filter((r) => r.teamId === team.id);
  const [kind, setKind] = useState<RegKind>("driver");
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const free = team.members.filter((m) => !mine.some((r) => r.userId === m.id) && (kind === "driver" ? m.roles.includes("driver") : hasAny(m.roles, PANEL_ROLES)));
  const username = kind === "spectator" ? name.trim() : pick || free[0]?.username || "";
  const hasDriver = mine.some((r) => r.kind === "driver");
  // A session can limit how many drivers each team fields; the team chooses who, until the cutoff.
  const limit = view.settings?.teamLimit ?? null;
  const pickOpen = limit !== null && view.pickUntil !== null && Date.now() <= view.pickUntil;
  const choosable = mine.filter((r) => r.kind === "driver" && (r.cut === "in" || r.cut === "out"));
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const sel = chosen ?? new Set(choosable.filter((r) => r.cut === "in").map((r) => r.userId));
  const toggle = (id: string) => setChosen((c) => { const n = new Set(c ?? sel); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Box title={team.name}>
      {limit !== null && (
        <Bd style={{ borderBottom: "1px dotted var(--s-line-l)" }}>
          At most {limit} of your drivers take part in this session.{pickOpen && view.pickUntil ? ` Choose who until ${fmt.format(view.pickUntil)}; until you do, your first registered drivers take part.` : " The choice is closed."}
        </Bd>
      )}
      {hasDriver && (
        <Bd style={{ borderBottom: "1px dotted var(--s-line-l)" }}>
          Ask your drivers to {link(GROUP_URL, "join the RSMA Roblox group")} (a pending request counts) before the deadline, or they cannot race.
        </Bd>
      )}
      {mine.length === 0 ? (
        <Bd><div className="note">Nobody registered.</div></Bd>
      ) : (
        <Bd flush>
          <table className="t">
            <tbody>
              {mine.map((r) => (
                <tr key={r.userId}>
                  <td>{pickOpen && choosable.some((c) => c.userId === r.userId) ? (
                    <label className="plain">
                      <input type="checkbox" checked={sel.has(r.userId)} disabled={!sel.has(r.userId) && sel.size >= (limit ?? 0)} onChange={() => toggle(r.userId)} /> {r.username}
                    </label>
                  ) : r.username}</td>
                  <td className="mute">{REG_KIND_LABEL[r.kind]}</td>
                  <td>{CUT_LABEL[r.cut]}</td>
                  {open && (
                    <td className="n">
                      <button className="btn sm red" onClick={() => act(registrationApi.teamRemove(sid, team.id, r.userId))}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Bd>
      )}
      {pickOpen && choosable.length > 0 && (
        <Bd top bar>
          <button className="btn pri" disabled={chosen === null} onClick={async () => { if (await act(registrationApi.setPicks(sid, team.id, [...sel]))) setChosen(null); }}>
            Save drivers for this session
          </button>
          <span className="mute">{sel.size} of {limit} chosen</span>
        </Bd>
      )}
      {open && (
        <Bd top bar>
          <select aria-label="Kind" value={kind} onChange={(e) => { setKind(e.target.value as RegKind); setPick(""); }}>
            {REG_KINDS.map((k) => <option key={k} value={k}>{REG_KIND_LABEL[k]}</option>)}
          </select>
          {kind === "spectator" ? (
            <input type="text" style={{ flex: 1, minWidth: 180 }} placeholder="Roblox username" aria-label="Spectator username" value={name} onChange={(e) => setName(e.target.value)} />
          ) : (
            <select style={{ flex: 1, minWidth: 160 }} aria-label="Person" value={pick || free[0]?.username || ""} onChange={(e) => setPick(e.target.value)}>
              {free.map((m) => <option key={m.id} value={m.username}>{m.username}</option>)}
            </select>
          )}
          <button
            className="btn pri"
            disabled={!username}
            onClick={async () => {
              if (await act(registrationApi.teamAdd(sid, team.id, username, kind))) { setName(""); setPick(""); }
            }}
          >
            Register
          </button>
        </Bd>
      )}
    </Box>
  );
}
