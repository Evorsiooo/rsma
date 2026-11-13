import { useCallback, useEffect, useState } from "react";
import { startSignIn, useTokenMode } from "./access";
import { GROUP_URL, inGroup, REG_KIND_LABEL, type RegSummary, type RegistrationView } from "../shared/registration";
import type { RaceSummary } from "../shared/types";
import { api, registrationApi } from "./api";
import { useMe } from "./me";
import { fmtWhen, regStatus, upcomingSessions } from "./regUi";
import { Link } from "react-router-dom";
import { DISCORD_URL } from "./Shell";
import { Bd, Box } from "./site/parts";
import { toast } from "./ui";

const ERRORS: Record<string, string> = {
  not_open: "Registration is not open.",
  no_such_roblox_user: "No Roblox user with that name.",
  lookup_failed: "Could not reach Roblox. Try again in a moment.",
  rate_limited: "Too many requests. Try again in a few minutes.",
  invalid_username: "Enter your Roblox username.",
  taken: "Already registered, by a team or as an independent.",
  invalid_discord: "Enter your Discord username.",
  group_required: "Tick the box to confirm you are in the group or have sent a join request.",
  independents_closed: "Independent drivers cannot register for this session.",
  unauthorized: "Sign in first.",
};
const say = (e: string) => toast(ERRORS[e] ?? "Request failed.");

const CUT_LABEL = { in: "In", waitlist: "Waiting", denied: "Denied" } as const;

const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

/** Driver registration: independent drivers sign up for a session; drivers registered by a team confirm the group. */
export function DriverRegistration() {
  const { me } = useMe();
  const [races, setRaces] = useState<RaceSummary[]>([]);
  const [regs, setRegs] = useState<RegSummary[] | null>(null);
  const [pick, setPick] = useState("");
  const [view, setView] = useState<RegistrationView | null>(null);
  const [discord, setDiscord] = useState("");
  const [joined, setJoined] = useState(false);
  const [username, setUsername] = useState("");
  const [sent, setSent] = useState(false);
  const tokens = useTokenMode();
  useEffect(() => {
    api.races().then(setRaces, () => {});
    registrationApi.list().then(setRegs, () => setRegs([]));
  }, []);
  const now = Date.now();
  const options = upcomingSessions(races, regs ?? [], now).filter((u) => u.reg && u.reg.independents && u.reg.root === u.session.id && regStatus(u.reg, now).phase !== "closed");
  const chosen = options.find((u) => u.session.id === pick) ?? options[0];
  const sid = chosen?.session.id ?? "";
  const load = useCallback(() => (sid ? registrationApi.get(sid).then(setView, () => setView(null)) : Promise.resolve()), [sid]);
  useEffect(() => {
    setView(null);
    load();
  }, [load]);
  const act = async (p: Promise<{ ok: true } | { ok: false; error: string }>) => {
    const r = await p;
    if (!r.ok) say(r.error);
    await load();
    return r.ok;
  };
  const status = chosen?.reg ? regStatus(chosen.reg, now) : null;
  const open = status?.phase === "open";
  const self = view?.self ?? null;
  const group = view?.group ?? [];
  const alsoCovers = group.filter((m) => m.id !== sid);
  const joinedSessions = group.filter((m) => !(m.teamsOnly && !self?.teamId));

  const groupCheck = (
    <label className="plain">
      <input type="checkbox" checked={joined} onChange={(e) => setJoined(e.target.checked)} /> I have joined the RSMA Roblox group or my request is pending
    </label>
  );
  return (
    <>
      <Box title="Race for a Team">
        <Bd>
          <p style={{ marginBottom: 8 }}>
            Teams that are hiring post in #team-updates on the RSMA Discord. Team drivers are registered for sessions by their team and have reserved slots.
          </p>
          <div className="bar">
            <a className="btn pri" href={DISCORD_URL} target="_blank" rel="noreferrer">Find a Team on Discord</a>
            <Link className="btn" to="/team-registration">Register a Team</Link>
          </div>
        </Bd>
      </Box>
      <Box title="Independent Driver Registration">
        <Bd>
          <p style={{ marginBottom: 8 }}>
            Independent drivers race without a team. To race you must be in the {link(GROUP_URL, "RSMA Roblox group")}. Make sure you are in the group or that you have sent a join request, before the deadline. Staff use your Discord username to contact you.
          </p>
          {regs && options.length === 0 && <div className="mute">No session is open for driver registration.</div>}
          {chosen && status && (
            <div className="bar">
              <select aria-label="Session" style={{ width: 300 }} value={sid} onChange={(e) => setPick(e.target.value)}>
                {options.map((u) => (
                  <option key={u.session.id} value={u.session.id}>
                    {u.race.name} · {u.session.name}
                  </option>
                ))}
              </select>
              <span className="mute">{status.text}</span>
            </div>
          )}
          {alsoCovers.length > 0 && (
            <div className="mute" style={{ marginTop: 6 }}>
              One registration covers {group.map((m) => m.name + (m.teamsOnly ? " (teams only)" : "")).join(", ")}.
            </div>
          )}
        </Bd>
      </Box>
      {chosen && self && (
        <Box title="Your Registration">
          <Bd flush>
            <table className="t">
              <tbody>
                <tr>
                  <td><b>{REG_KIND_LABEL[self.kind]}{self.teamName ? ` · ${self.teamName}` : " · Independent"}</b></td>
                  <td style={{ width: 90 }}>{CUT_LABEL[self.cut]}</td>
                </tr>
                {group.length > 1 && (
                  <tr>
                    <td colSpan={2} className="mute">Registered for {joinedSessions.map((m) => m.name).join(", ")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Bd>
          {self.kind === "driver" && (
            <Bd top bar style={{ justifyContent: "space-between" }}>
              <label>
                <input type="checkbox" checked={inGroup(self.group)} disabled={!open} onChange={(e) => act(registrationApi.selfGroup(sid, e.target.checked ? "pending" : "unverified"))} /> I have joined the RSMA Roblox group or my request is pending
              </label>
              {open && !self.teamId && (
                <button className="btn red" onClick={() => act(registrationApi.withdraw(sid))}>{joinedSessions.length > 1 ? "Withdraw from all" : "Withdraw"}</button>
              )}
            </Bd>
          )}
        </Box>
      )}
      {chosen && view && !self && open && (
        <Box title={`${chosen.race.name} · ${chosen.session.name} · starts ${fmtWhen(chosen.session.startsAt)}`}>
          <Bd>
            {!me && tokens ? (
              sent ? (
                <p>Registered. Staff will contact you on Discord with an access code to sign in.</p>
              ) : (
                <div className="frm">
                  <label htmlFor="rn">Roblox username</label>
                  <input id="rn" type="text" style={{ maxWidth: 260 }} maxLength={20} value={username} onChange={(e) => setUsername(e.target.value)} />
                  <label htmlFor="dn">Discord username</label>
                  <input id="dn" type="text" style={{ maxWidth: 260 }} maxLength={32} value={discord} onChange={(e) => setDiscord(e.target.value)} />
                  <span />
                  {groupCheck}
                  <span />
                  <div className="bar">
                    <button
                      className="btn pri"
                      disabled={!username.trim() || !discord.trim() || !joined}
                      onClick={async () => {
                        if (await act(registrationApi.independentRequest(sid, username.trim(), discord.trim()))) setSent(true);
                      }}
                    >
                      Register
                    </button>
                    <button className="btn" onClick={() => startSignIn("/driver-registration")}>I have an access code</button>
                  </div>
                </div>
              )
            ) : !me ? (
              <button className="btn pri" onClick={() => startSignIn("/driver-registration")}>Sign in to register</button>
            ) : (
              <div className="frm">
                <label htmlFor="dn">Discord username</label>
                <input id="dn" type="text" style={{ maxWidth: 260 }} maxLength={32} value={discord} onChange={(e) => setDiscord(e.target.value)} />
                <span />
                {groupCheck}
                <span />
                <button className="btn pri" style={{ justifySelf: "start" }} disabled={!discord.trim() || !joined} onClick={() => act(registrationApi.independent(sid, discord.trim()))}>
                  Register
                </button>
              </div>
            )}
          </Bd>
          {!me && tokens && sent && (
            <Bd top bar><button className="btn" onClick={() => startSignIn("/driver-registration")}>I have an access code</button></Bd>
          )}
        </Box>
      )}
    </>
  );
}
