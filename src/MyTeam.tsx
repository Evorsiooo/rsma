import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type { RegSummary } from "../shared/registration";
import type { MyTeam as MyTeamData, RaceSummary } from "../shared/types";
import { hasAny, MANAGER_ROLES, TEAM_ROLE_LABEL } from "../shared/teams";
import { api, myTeam, registrationApi } from "./api";
import { fmtWhen, regStatus, upcomingSessions } from "./regUi";
import { useMe } from "./me";
import { CodeDialog, useTokenMode } from "./access";
import { Bd, Box } from "./site/parts";
import { AddMember, MemberTable } from "./TeamMembers";
import { Dialog, toast } from "./ui";
import { NotFound } from "./NotFound";

const ERRORS: Record<string, string> = {
  invalid_username: "Enter a Roblox username (3-20 letters, numbers or underscores).",
  no_such_roblox_user: "No Roblox user with that name.",
  lookup_failed: "Could not reach Roblox. Try again in a moment.",
  already_member: "Already in this team.",
  principal_fixed: "The Team Principal cannot be changed or removed.",
  invalid_roles: "Pick at least one role.",
  forbidden: "Not allowed.",
};
const say = (e: string) => toast(ERRORS[e] ?? "Request failed.");

/** /my-team: straight to the team when there is one, a choice when there are several. */
export function MyTeamPicker() {
  const { me } = useMe();
  const nav = useNavigate();
  if (!me) return <NotFound />;
  if (me.memberships.length === 0) return <NotFound />;
  if (me.memberships.length === 1) return <Navigate to={`/my-team/${me.memberships[0].id}`} replace />;
  return (
    <Box title="My Team">
      <Bd flush>
        <table className="t">
          <tbody>
            {me.memberships.map((t) => (
              <tr key={t.id}>
                <td><b>{t.name}</b></td>
                <td className="mute">{t.roles.map((r) => TEAM_ROLE_LABEL[r]).join(", ")}</td>
                <td className="n"><Link className="btn pri sm" to={`/my-team/${t.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Bd>
    </Box>
  );
}

export function MyTeamPage() {
  const { teamId = "" } = useParams();
  const { me, setMe } = useMe();
  const nav = useNavigate();
  const [team, setTeam] = useState<MyTeamData | null>(null);
  const [missing, setMissing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const tokens = useTokenMode();
  const [codeFor, setCodeFor] = useState<{ id: string; username: string } | null>(null);
  const [races, setRaces] = useState<RaceSummary[]>([]);
  const [regs, setRegs] = useState<RegSummary[]>([]);
  useEffect(() => {
    api.races().then(setRaces, () => {});
    registrationApi.list().then(setRegs, () => {});
  }, []);
  const load = useCallback(() => myTeam.get(teamId).then(setTeam, () => setMissing(true)), [teamId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!me || missing) return <NotFound />;
  if (!team) return <Box title="My Team"><Bd><div className="note">Loading...</div></Bd></Box>;
  const canEdit = hasAny(team.roles, MANAGER_ROLES);
  const sub = team.kind === "factory" ? team.car : team.factoryName ? `Runs the ${team.factoryName} car` : null;
  const act = async (p: Promise<{ ok: true } | { ok: false; error: string }>) => {
    const r = await p;
    if (!r.ok) say(r.error);
    await load();
    return r.ok;
  };
  const now = Date.now();
  const sessions = upcomingSessions(races, regs, now);
  const panel = me.teams.some((t) => t.id === team.id);
  return (
    <>
      {sessions.length > 0 && (
        <Box title="Upcoming Sessions">
          <Bd flush>
            <table className="t">
              <tbody>
                {sessions.map(({ race, session, reg }) => {
                  const st = reg ? regStatus(reg, now) : null;
                  // Linked sessions are registered for once, with the first session of the group.
                  const head = reg && reg.root !== session.id ? races.flatMap((r) => r.sessions).find((x) => x.id === reg.root) : undefined;
                  return (
                    <tr key={session.id}>
                      <td>{race.name} · {session.name}</td>
                      <td>{fmtWhen(session.startsAt)}</td>
                      <td className="mute">{head ? `Registered with ${head.name}` : (st?.text ?? "")}</td>
                      <td className="n">
                        {canEdit && !head && st?.phase === "open" && <Link className="btn pri sm" to={`/session/${session.id}/register`}>Register</Link>}{" "}
                        {panel && <Link className="btn sm" to={`/session/${session.id}/team/${team.id}`}>Team panel</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Bd>
        </Box>
      )}
      <Box title={`${team.name}${sub ? ` · ${sub}` : ""}`}>
        <Bd flush>
          <MemberTable
            members={team.members}
            meId={me.id}
            canEdit={canEdit}
            onCode={tokens ? setCodeFor : undefined}
            onRoles={(m, roles) => act(myTeam.setRoles(team.id, m.id, roles))}
            onRemove={(m) => act(myTeam.remove(team.id, m.id))}
          />
        </Bd>
        {canEdit && (
          <Bd top bar>
            <AddMember onAdd={(username, roles) => act(myTeam.add(team.id, username, roles))} />
          </Bd>
        )}
      </Box>
      {!team.roles.includes("principal") && (
        <div>
          <button className="btn red" onClick={() => setLeaving(true)}>
            Leave team
          </button>
        </div>
      )}
      {codeFor && <CodeDialog name={codeFor.username} issue={() => myTeam.code(team.id, codeFor.id)} revoke={() => myTeam.revokeCode(team.id, codeFor.id)} onClose={() => setCodeFor(null)} />}
      {leaving && (
        <Dialog
          title="Leave team"
          size="s"
          onClose={() => setLeaving(false)}
          foot={
            <>
              <button className="r-btn" onClick={() => setLeaving(false)}>Cancel</button>
              <button
                className="r-btn"
                onClick={async () => {
                  const r = await myTeam.leave(team.id);
                  if (!r.ok) return say(r.error);
                  setMe({ ...me, teams: me.teams.filter((t) => t.id !== team.id), memberships: me.memberships.filter((t) => t.id !== team.id) });
                  nav("/");
                }}
              >
                Leave
              </button>
            </>
          }
        >
          <div>You leave {team.name} and lose its panel access.</div>
        </Dialog>
      )}
    </>
  );
}
