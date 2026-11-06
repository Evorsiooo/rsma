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
}: {
  members: Member[];
  canEdit: boolean;
  canSetPrincipal?: boolean;
  /** Narrow columns with wrapping headers, for dialogs. */
  compact?: boolean;
  onRoles: (m: Member, roles: TeamRole[]) => void;
  onRemove: (m: Member) => void;
}) {
  if (members.length === 0) return <div className="r-empty">No members.</div>;
  return (
    <table className="r-table">
      <thead>
        <tr>
          <th className="is-left">Username</th>
          {TEAM_ROLES.map((r) => (
            <th key={r} style={{ width: compact ? 94 : 160, whiteSpace: "normal", verticalAlign: "bottom" }}>{TEAM_ROLE_LABEL[r]}</th>
          ))}
          {canEdit && <th style={{ width: compact ? 80 : 100 }} />}
        </tr>
      </thead>
      <tbody>
        {members.map((m) => {
          const fixed = !canSetPrincipal && m.roles.includes("principal");
          return (
            <tr key={m.id}>
              <td className="is-left">{m.username}</td>
              {TEAM_ROLES.map((r) => (
                <td key={r}>
                  <label className="r-check" style={{ justifyContent: "center" }}>
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
                  </label>
                </td>
              ))}
              {canEdit && (
                <td style={{ padding: 2 }}>
                  {!fixed && (
                    <button className="r-btn r-cell--red" style={{ width: "100%", height: 24, paddingTop: 2 }} onClick={() => onRemove(m)}>
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
      <div className="r-row">
        {TEAM_ROLES.filter((r) => canSetPrincipal || r !== "principal").map((r) => (
          <label key={r} className="r-check">
            <input
              type="checkbox"
              checked={roles.includes(r)}
              onChange={(e) => setRoles(TEAM_ROLES.filter((x) => (x === r ? e.target.checked : roles.includes(x))))}
            />
            <span>{TEAM_ROLE_LABEL[r]}</span>
          </label>
        ))}
      </div>
      <div className="r-row">
        <input className="r-field r-fill" placeholder="Roblox username" aria-label="Member username" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="r-btn" style={{ width: 100 }} disabled={!name.trim() || !roles.length} onClick={add}>Add</button>
      </div>
    </>
  );
}
