import { useCallback, useEffect, useState } from "react";
import { GROUP_URL, inGroup, REG_KIND_LABEL, type RegSummary, type RegistrationView } from "../shared/registration";
import type { RaceSummary } from "../shared/types";
import { api, registrationApi } from "./api";
import { useMe } from "./me";
import { fmtWhen, regStatus, upcomingSessions } from "./regUi";
import { DISCORD_URL, Shell } from "./Shell";
import { toast } from "./ui";

const ERRORS: Record<string, string> = {
  not_open: "Registration is not open.",
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
  useEffect(() => {
    api.races().then(setRaces, () => {});
    registrationApi.list().then(setRegs, () => setRegs([]));
  }, []);
  const now = Date.now();
  const options = upcomingSessions(races, regs ?? [], now).filter((u) => u.reg && u.reg.independents && regStatus(u.reg, now).phase !== "closed");
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

  return (
    <Shell>
      <div className="r-panel">
        <div className="r-header">Driver registration</div>
        <div style={{ padding: 4, display: "grid", gap: 8 }}>
          <div>
            Independent drivers race without a team. To race you must be in the {link(GROUP_URL, "RSMA Roblox group")}. Make sure you are in the group or that you have sent a join request, before the deadline. Staff use your Discord username to contact you.
          </div>
          <div>Looking for a team? Teams that are hiring post in #team-updates on the {link(DISCORD_URL, "RSMA Discord")}.</div>
          {regs && options.length === 0 && <div style={{ color: "var(--r-text-dim)" }}>No session is open for driver registration.</div>}
          {chosen && status && (
            <div className="r-row" style={{ alignItems: "center" }}>
              <div className="r-select r-fill">
                <select aria-label="Session" value={sid} onChange={(e) => setPick(e.target.value)}>
                  {options.map((u) => (
                    <option key={u.session.id} value={u.session.id}>
                      {u.race.name} · {u.session.name}
                    </option>
                  ))}
                </select>
              </div>
              <span style={{ width: 210, flex: "none", color: "var(--r-text-dim)" }}>{status.text}</span>
            </div>
          )}
        </div>
      </div>
      {chosen && self && (
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
                <input type="checkbox" checked={inGroup(self.group)} disabled={!open} onChange={(e) => act(registrationApi.selfGroup(sid, e.target.checked ? "pending" : "unverified"))} />
                <span>I have joined the RSMA Roblox group or my request is pending</span>
              </label>
              {open && !self.teamId && (
                <button className="r-btn r-cell--red" style={{ width: 120 }} onClick={() => act(registrationApi.withdraw(sid))}>Withdraw</button>
              )}
            </div>
          )}
        </div>
      )}
      {chosen && view && !self && open && (
        <div className="r-panel">
          <div className="r-header">{chosen.race.name} · {chosen.session.name} · starts {fmtWhen(chosen.session.startsAt)}</div>
          {!me ? (
            <div style={{ padding: 4 }}>
              <button className="r-btn" style={{ width: "100%" }} onClick={() => location.assign("/api/auth/roblox/login?next=/driver-registration")}>
                Sign in with Roblox to register
              </button>
            </div>
          ) : (
            <div style={{ padding: 4, display: "grid", gap: 8 }}>
              <input className="r-field" placeholder="Discord username" aria-label="Discord username" maxLength={32} value={discord} onChange={(e) => setDiscord(e.target.value)} />
              <label className="r-check">
                <input type="checkbox" checked={joined} onChange={(e) => setJoined(e.target.checked)} />
                <span>I have joined the RSMA Roblox group or my request is pending</span>
              </label>
              <button className="r-btn" disabled={!discord.trim() || !joined} onClick={() => act(registrationApi.independent(sid, discord.trim()))}>
                Register
              </button>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
