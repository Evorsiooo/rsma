import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { MyTeam as MyTeamData } from "../shared/types";
import { hasAny, MANAGER_ROLES, TEAM_ROLE_LABEL } from "../shared/teams";
import { myTeam } from "./api";
import { useMe } from "./me";
import { Shell } from "./Shell";
import { AddMember, MemberTable } from "./TeamMembers";
import { Dialog, toast } from "./ui";
import { NotFound } from "./NotFound";

const ERRORS: Record<string, string> = {
  invalid_username: "Enter a Roblox username (3-20 letters, numbers or underscores).",
  no_such_roblox_user: "No Roblox user with that name.",
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
    <Shell>
      <div className="r-panel">
        <div className="r-header">My Team</div>
        <table className="r-table">
          <tbody>
            {me.memberships.map((t) => (
              <tr key={t.id}>
                <td className="is-left">{t.name}</td>
                <td className="is-left" style={{ color: "var(--r-text-dim)" }}>{t.roles.map((r) => TEAM_ROLE_LABEL[r]).join(", ")}</td>
                <td style={{ width: 130, padding: 2 }}>
                  <button className="r-btn r-fill" style={{ width: "100%", height: 24, paddingTop: 2 }} onClick={() => nav(`/my-team/${t.id}`)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

export function MyTeamPage() {
  const { teamId = "" } = useParams();
  const { me, setMe } = useMe();
  const nav = useNavigate();
  const [team, setTeam] = useState<MyTeamData | null>(null);
  const [missing, setMissing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const load = useCallback(() => myTeam.get(teamId).then(setTeam, () => setMissing(true)), [teamId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!me || missing) return <NotFound />;
  if (!team) return <Shell><div className="r-panel" /></Shell>;
  const canEdit = hasAny(team.roles, MANAGER_ROLES);
  const sub = team.kind === "factory" ? team.car : team.factoryName ? `Runs the ${team.factoryName} car` : null;
  const act = async (p: Promise<{ ok: true } | { ok: false; error: string }>) => {
    const r = await p;
    if (!r.ok) say(r.error);
    await load();
    return r.ok;
  };
  return (
    <Shell wide>
      <div className="r-panel">
        <div className="r-header">{team.name}{sub ? ` · ${sub}` : ""}</div>
        <MemberTable
          members={team.members}
          canEdit={canEdit}
          onRoles={(m, roles) => act(myTeam.setRoles(team.id, m.id, roles))}
          onRemove={(m) => act(myTeam.remove(team.id, m.id))}
        />
        {canEdit && (
          <div style={{ padding: 4, display: "grid", gap: 4 }}>
            <AddMember onAdd={(username, roles) => act(myTeam.add(team.id, username, roles))} />
          </div>
        )}
      </div>
      {!team.roles.includes("principal") && (
        <div className="r-row">
          <button className="r-btn r-cell--red" style={{ width: 160 }} onClick={() => setLeaving(true)}>
            Leave team
          </button>
        </div>
      )}
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
    </Shell>
  );
}
