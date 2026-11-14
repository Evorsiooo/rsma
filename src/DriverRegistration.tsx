import { useBootData } from "./Layouts";
import { useCallback, useEffect, useState } from "react";
import { startSignIn, useTokenMode } from "./access";
import { fullNotice, GROUP_URL, groupSummary, inGroup, orderRule, REG_KIND_LABEL, spotsLine, statusText, type RegSummary, type RegistrationView } from "../shared/registration";
import type { RaceSummary } from "../shared/types";
import { api, registrationApi } from "./api";
import { useMe } from "./me";
import { fmtWhen, ownedTeams, regStatus, registrationEvents, upcomingSessions } from "./regUi";
import { Link } from "react-router-dom";
import { DISCORD_URL } from "./Shell";
import { Bd, Box } from "./site/parts";
import { Dialog, toast } from "./ui";

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


const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

/** Driver registration: independent drivers sign up for a session; drivers registered by a team confirm the group. */
export function DriverRegistration() {
  const { me } = useMe();
  const [races, setRaces] = useState<RaceSummary[]>(useBootData()?.races ?? []);
  const [regs, setRegs] = useState<RegSummary[] | null>(null);
  const [pick, setPick] = useState("");
  const [view, setView] = useState<RegistrationView | null>(null);
  const [discord, setDiscord] = useState("");
  const [joined, setJoined] = useState(false);
  const [username, setUsername] = useState("");
  const [sent, setSent] = useState(false);
  const [confirm, setConfirm] = useState(false);
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
  const summary = groupSummary(group);
  const owned = ownedTeams(me);
  const teams = me?.memberships ?? [];
  const names = (l: { name: string }[]) => l.map((t) => t.name).join(", ");
  const teamEvents = registrationEvents(upcomingSessions(races, regs ?? [], now), regs ?? [], now);
  const joinedSessions = group.filter((m) => !(m.teamsOnly && !self?.teamId));

  const groupCheck = (
    <label className="plain">
      <input type="checkbox" checked={joined} onChange={(e) => setJoined(e.target.checked)} /> I have joined the RSMA Roblox group or my request is pending
    </label>
  );
  return (
    <>
      <Box title="Become a Driver">
        <Bd>
          There are two ways to race in the RSMA: for a team, or without one. Teams register their drivers for each session. Drivers without a team register themselves.
        </Bd>
      </Box>
      {owned.length > 0 ? (
        <Box title={`Race for a Team · ${names(owned)}`}>
          <Bd>You own {names(owned)}. Register your drivers for an event below, or open the team page.</Bd>
          {regs && teamEvents.length > 0 ? (
            <Bd top flush>
              <table className="t">
                <tbody>
                  {teamEvents.map(({ race, reg }) => {
                    const st = regStatus(reg, now);
                    return (
                      <tr key={race.id}>
                        <td>{race.name}</td>
                        <td className="mute">{st.text}</td>
                        <td className="n">
                          {st.phase === "upcoming" ? null : <Link className={`btn sm${st.phase === "open" ? " pri" : ""}`} to={`/race/${race.id}/register`}>{st.phase === "open" ? "Register drivers" : "View"}</Link>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Bd>
          ) : (
            <Bd top><div className="mute">{regs ? "No event has registration yet." : "Loading..."}</div></Bd>
          )}
          <Bd top bar>
            <Link className="btn" to={owned.length === 1 ? `/my-team/${owned[0].id}` : "/my-team"}>{owned.length === 1 ? "Team page" : "My Teams"}</Link>
          </Bd>
        </Box>
      ) : teams.length === 0 ? (
        <Box title="Race for a Team">
          <Bd>
            Teams that are hiring post in #team-updates on the RSMA Discord. Your team registers you for sessions, and team drivers have reserved slots. This is the usual way in.
          </Bd>
          <Bd top bar>
            <a className="btn pri" href={DISCORD_URL} target="_blank" rel="noreferrer">Find a Team on Discord</a>
            <Link className="btn" to="/team-registration">Register a Team</Link>
          </Bd>
        </Box>
      ) : (
        <Box title={`Race for a Team · ${names(teams)}`}>
          <Bd>You are in {names(teams)}. Your team registers you for sessions, so you do not need to register yourself.</Bd>
          <Bd top bar>
            <Link className="btn pri" to={teams.length === 1 ? `/my-team/${teams[0].id}` : "/my-team"}>{teams.length === 1 ? "Team page" : "My Teams"}</Link>
          </Bd>
        </Box>
      )}
      <Box title="Race Without a Team">
        <Bd>
          {teams.length > 0 && <b>Only for drivers without a team. </b>}Independent drivers register themselves for each session. To race you must be in the {link(GROUP_URL, "RSMA Roblox group")}. Make sure you are in the group or that you have sent a join request, before the deadline. Staff use your Discord username to contact you.
        </Bd>
        {regs && options.length === 0 && <Bd top><div className="mute">No session is open for drivers without a team.</div></Bd>}
        {chosen && status && (
          <Bd top>
            <div className="bar">
              <select aria-label="Session" style={{ width: 300 }} value={sid} onChange={(e) => setPick(e.target.value)}>
                {options.map((u) => (
                  <option key={u.session.id} value={u.session.id}>
                    {u.race.name} · {u.session.name}
                  </option>
                ))}
              </select>
              <span className="mute">Starts {fmtWhen(chosen.session.startsAt)} · {status.text}</span>
            </div>
            {alsoCovers.length > 0 && (
              <div className="mute" style={{ marginTop: 6 }}>
                {summary?.independents} {summary?.teams} One list of spots for all of them: you get the same result in each session you take part in.
              </div>
            )}
            {view?.settings && (
              <div style={{ marginTop: 6 }}>
                <div>Driver spots: {spotsLine(view.counts.driver)}.</div>
                <div className="mute">{orderRule(view.settings)}</div>
                {open && !self && fullNotice(view.counts.driver, "driver") && <div style={{ marginTop: 6 }}><b>{fullNotice(view.counts.driver, "driver")}</b></div>}
              </div>
            )}
          </Bd>
        )}
        {chosen && self && (
          <>
          <Bd top flush>
            <table className="t">
              <tbody>
                <tr>
                  <td><b>{REG_KIND_LABEL[self.kind]}{self.teamName ? ` · ${self.teamName}` : " · Independent"}</b></td>
                  <td style={{ width: 170 }}>{statusText(self)}</td>
                </tr>
                {self.cut === "waitlist" && (
                  <tr>
                    <td colSpan={2} className="mute">
                      Registration stays open. {self.waitPos && self.waitPos > 1 ? `${self.waitPos - 1} ${self.waitPos === 2 ? "person is" : "people are"} ahead of you.` : "You are next."} You move up when someone ahead of you withdraws or is denied.
                    </td>
                  </tr>
                )}
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
          </>
        )}
        {chosen && view && !self && open && (
          <>
          <Bd top>
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
                <button className="btn pri" style={{ justifySelf: "start" }} disabled={!discord.trim() || !joined} onClick={() => (teams.length > 0 ? setConfirm(true) : act(registrationApi.independent(sid, discord.trim())))}>
                  Register
                </button>
              </div>
            )}
          </Bd>
          </>
        )}
        {chosen && view && !self && open && !me && tokens && sent && (
          <Bd top bar><button className="btn" onClick={() => startSignIn("/driver-registration")}>I have an access code</button></Bd>
        )}
      </Box>
      {confirm && (
        <Dialog
          title="Register as an independent?"
          onClose={() => setConfirm(false)}
          foot={
            <>
              <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              <button
                className="btn pri"
                onClick={async () => {
                  setConfirm(false);
                  await act(registrationApi.independent(sid, discord.trim()));
                }}
              >
                Register as independent
              </button>
            </>
          }
        >
          <p>
            You are in {names(teams)}. Registering as an independent means racing without {teams.length > 1 ? "a team" : "your team"} in this session. {teams.length > 1 ? "Teams register" : `${teams[0].name} registers`} drivers from the team page.
          </p>
        </Dialog>
      )}
    </>
  );
}
