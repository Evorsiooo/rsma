import { DISCORD_URL, Shell } from "./Shell";

export function TeamRegistration() {
  return (
    <Shell>
      <div className="r-panel">
        <div className="r-header">Team registration</div>
        <div style={{ padding: 8, display: "grid", gap: 8 }}>
          <div>
            To register a team, open a ticket in #contact-us on the RSMA Discord.
          </div>
          <div>A team needs at least 2 drivers and its own Discord server.</div>
          <button className="r-btn" style={{ width: 160 }} onClick={() => window.open(DISCORD_URL, "_blank", "noopener")}>
            RSMA Discord
          </button>
        </div>
      </div>
    </Shell>
  );
}
