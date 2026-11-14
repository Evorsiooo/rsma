import { Navigate } from "react-router-dom";
import { useMe } from "./me";
import { ownedTeams } from "./regUi";
import { DISCORD_URL } from "./Shell";
import { Bd, Box } from "./site/parts";

export function TeamRegistration() {
  const { me } = useMe();
  // A team owner already has a team: straight to it (a choice when they have several).
  if (ownedTeams(me).length > 0) return <Navigate to="/my-team" replace />;
  return (
    <Box title="Team Registration">
      <Bd>
        <p style={{ marginBottom: 4 }}>To register a team, open a ticket in #contact-us on the RSMA Discord.</p>
        <p style={{ marginBottom: 8 }}>A team needs at least 2 drivers and its own Discord server.</p>
        <a className="btn pri" href={DISCORD_URL} target="_blank" rel="noreferrer">RSMA Discord</a>
      </Bd>
    </Box>
  );
}
