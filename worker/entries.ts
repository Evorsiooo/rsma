/**
 * Cars (entries) of endurance events. A car is kept only while its team and registration exist, and its drivers only while
 * they are still registered drivers of that team. Everything that removes a registration or a team appends these
 * statements to its own, so lineups close up on their own: the next reserve moves up.
 */
export function pruneStatements(db: D1Database): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM entries WHERE team_id NOT IN (SELECT id FROM teams) OR root_session NOT IN (SELECT session_id FROM session_registration)"),
    db.prepare("DELETE FROM entry_drivers WHERE entry_id NOT IN (SELECT id FROM entries)"),
    db.prepare(
      `DELETE FROM entry_drivers WHERE NOT EXISTS (
         SELECT 1 FROM registrations r JOIN entries e ON e.id = entry_drivers.entry_id
         WHERE r.session_id = entry_drivers.root_session AND r.roblox_id = entry_drivers.roblox_id AND r.team_id = e.team_id AND r.kind = 'driver'
       )`,
    ),
  ];
}
