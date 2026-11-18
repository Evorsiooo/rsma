import { Navigate } from "react-router-dom";
import { useMe } from "./me";
import { ownedTeams } from "./regUi";
import { DISCORD_URL } from "./Shell";
import { Bd, Box } from "./site/parts";

const AGREEMENT_URL = "https://docs.google.com/document/d/1ffmHj04FdS6zkQUtIiwKLNPYd6tH-nYWgVU8vSk5qeQ/edit?usp=sharing";

export function TeamRegistration() {
  const { me } = useMe();
  // A team owner already has a team: straight to it (a choice when they have several).
  if (ownedTeams(me).length > 0) return <Navigate to="/my-team" replace />;
  const requirements: React.ReactNode[] = [
    "At least two drivers. The team owner can be one of them.",
    "A Discord server for the team.",
    <>An announcements channel in that server that can be followed in #team-updates on the RSMA Discord.</>,
    <>Ready to sign the <a href={AGREEMENT_URL} target="_blank" rel="noreferrer">Jamestown agreement</a>.</>,
    "Contact a factory team so they supply you with cars.",
    "Not a factory programme (its own car brand with custom cars).",
  ];
  return (
    <>
      <Box title="Team Requirements">
        <Bd flush>
          <table className="t">
            <tbody>
              {requirements.map((r, i) => (
                <tr key={i}>
                  <td style={{ width: 32 }} className="mute">{i + 1}</td>
                  <td>{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Bd>
      </Box>
      <Box title="Team Registration">
        <Bd>
          <p style={{ marginBottom: 8 }}>To register a team, open a ticket in #contact-us on the RSMA Discord.</p>
          <a className="btn pri" href={DISCORD_URL} target="_blank" rel="noreferrer">RSMA Discord</a>
        </Bd>
      </Box>
    </>
  );
}
