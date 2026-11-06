import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { GROUP_URL, inGroup, REG_KIND_LABEL, REG_KINDS, type RegKind, type RegistrationView, type RegTeam } from "../shared/registration";
import { PANEL_ROLES, hasAny } from "../shared/teams";
import type { SessionInfo } from "../shared/types";
import { api, registrationApi } from "./api";
import { useMe } from "./me";
import { NotFound } from "./NotFound";
import { Shell } from "./Shell";
import { DISCORD_URL } from "./Shell";
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
    </Shell>
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
  return (
    <div className="r-panel">
      <div className="r-header">{team.name}</div>
      {hasDriver && (
        <div className="r-banner is-teal">
          Ask your drivers to {link(GROUP_URL, "join the RSMA Roblox group")} (a pending request counts) before the deadline, or they cannot race.
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
                <td style={{ width: 130, ...dim }}>{r.kind === "driver" ? (inGroup(r.group) ? "In group" : "Not in group") : ""}</td>
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

const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

function Own({ view, open, sid, signedIn, act }: { view: RegistrationView; open: boolean; sid: string; signedIn: boolean; act: (p: Promise<Res>) => Promise<boolean> }) {
  const [discord, setDiscord] = useState("");
  const [joined, setJoined] = useState(false);
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
            <label className="r-check r-fill">
              <input
                type="checkbox"
                checked={inGroup(self.group)}
                disabled={!open}
                onChange={(e) => act(registrationApi.selfGroup(sid, e.target.checked ? "pending" : "unverified"))}
              />
              <span>I have joined the {link(GROUP_URL, "RSMA Roblox group")} or my request is pending</span>
            </label>
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
      <div style={{ padding: 4, display: "grid", gap: 8 }}>
        <div>
          Independent drivers race without a team. To race you must be in the {link(GROUP_URL, "RSMA Roblox group")}: join it, or at least send a join request, before the deadline. Staff use your Discord username to contact you.
        </div>
        <div>Looking for a team? Teams that are hiring post in #team-updates on the {link(DISCORD_URL, "RSMA Discord")}.</div>
        <input className="r-field" placeholder="Discord username" aria-label="Discord username" maxLength={32} value={discord} onChange={(e) => setDiscord(e.target.value)} />
        <label className="r-check">
          <input type="checkbox" checked={joined} onChange={(e) => setJoined(e.target.checked)} />
          <span>I have joined the RSMA Roblox group or my request is pending</span>
        </label>
        <button className="r-btn" disabled={!discord.trim() || !joined} onClick={() => act(registrationApi.independent(sid, discord.trim()))}>
          Register
        </button>
      </div>
    </div>
  );
}
