import { useState } from "react";
import { TEAM_ROLE_LABEL, TEAM_ROLES, type TeamRole } from "../shared/teams";

export interface Member {
  id: string;
  username: string;
  roles: TeamRole[];
}

/** Members with a checkbox per role and a Remove button. The Team Principal row is locked unless `canSetPrincipal`. */
export function MemberTable({
  members,
  canEdit,
  canSetPrincipal,
  compact,
  onRoles,
  onRemove,
  onCode,
  meId,
}: {
  members: Member[];
  canEdit: boolean;
  canSetPrincipal?: boolean;
  /** Narrow columns with wrapping headers, for dialogs. */
  compact?: boolean;
  onRoles: (m: Member, roles: TeamRole[]) => void;
  onRemove: (m: Member) => void;
  /** Hand out an access code; shown only when given. */
  onCode?: (m: Member) => void;
  /** Highlights the signed-in user's row. */
  meId?: string;
}) {
  if (members.length === 0) return <div className="bd note">No members.</div>;
  return (
    <table className="t">
      <thead>
        <tr>
          <th>Username</th>
          {TEAM_ROLES.map((r) => (
            <th key={r} className="c" style={{ whiteSpace: compact ? "normal" : undefined, verticalAlign: "bottom" }}>{TEAM_ROLE_LABEL[r]}</th>
          ))}
          {canEdit && <th />}
        </tr>
      </thead>
      <tbody>
        {members.map((m) => {
          const fixed = !canSetPrincipal && m.roles.includes("principal");
          return (
            <tr key={m.id} className={m.id === meId ? "mine" : undefined}>
              <td>{m.id === meId ? <b>{m.username}</b> : m.username}</td>
              {TEAM_ROLES.map((r) => (
                <td key={r} className="c">
                  <input
                    type="checkbox"
                    aria-label={`${m.username} ${TEAM_ROLE_LABEL[r]}`}
                    checked={m.roles.includes(r)}
                    disabled={!canEdit || fixed || (r === "principal" && !canSetPrincipal)}
                    onChange={(e) => {
                      const next = TEAM_ROLES.filter((x) => (x === r ? e.target.checked : m.roles.includes(x)));
                      if (next.length) onRoles(m, next);
                    }}
                  />
                </td>
              ))}
              {canEdit && (
                <td className="n">
                  {!fixed && onCode && (
                    <button className="btn sm" onClick={() => onCode(m)}>
                      Code
                    </button>
                  )}{" "}
                  {!fixed && (
                    <button className="btn sm red" onClick={() => onRemove(m)}>
                      Remove
                    </button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Username field and role ticks for adding a person. Principal can only be given by an admin. */
export function AddMember({ canSetPrincipal, onAdd }: { canSetPrincipal?: boolean; onAdd: (username: string, roles: TeamRole[]) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<TeamRole[]>(["driver"]);
  const add = async () => {
    if (!name.trim() || !roles.length) return;
    if (await onAdd(name.trim(), roles)) setName("");
  };
  return (
    <>
      {TEAM_ROLES.filter((r) => canSetPrincipal || r !== "principal").map((r) => (
        <label key={r}>
          <input
            type="checkbox"
            checked={roles.includes(r)}
            onChange={(e) => setRoles(TEAM_ROLES.filter((x) => (x === r ? e.target.checked : roles.includes(x))))}
          />{" "}
          {TEAM_ROLE_LABEL[r]}
        </label>
      ))}
      <input type="text" style={{ flex: 1, minWidth: 180 }} placeholder="Roblox username" aria-label="Member username" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <button className="btn pri" disabled={!name.trim() || !roles.length} onClick={add}>Add</button>
    </>
  );
}
