import { DISCORD_URL, Shell } from "./Shell";

interface Position {
  title: string;
  responsibilities: string;
  reportsTo: string;
}

interface Department {
  name: string;
  positions: Position[];
}

const DEPARTMENTS: Department[] = [
  {
    name: "Sporting & Administration",
    positions: [
      {
        title: "Secretary General for Sport (Department Head)",
        responsibilities:
          "Heads the administrative secretariat. Handles governance compliance, drafts official cross-state sanctioning agreements, and maintains the official RSMA rulebook and statutes.",
        reportsTo: "RSMA President",
      },
      {
        title: "Sporting Director",
        responsibilities:
          "Manages the sporting integrity of the championship. Organizes the bi-weekly calendar, venue rotations, and structures non-championship/grassroots exhibition events.",
        reportsTo: "Secretary General for Sport",
      },
      {
        title: "Entries & Paddock Coordinator",
        responsibilities:
          "Manages team entry registries, processes driver competition licenses, and coordinates physical paddock/garage allocations on race weekends.",
        reportsTo: "Secretary General for Sport",
      },
    ],
  },
  {
    name: "Race Direction & Technical",
    positions: [
      {
        title: "Race Director (Department Head)",
        responsibilities:
          "Commands Race Control, oversees the starting procedures, initiates incident inquiries, and makes the call to deploy the Safety Car.",
        reportsTo: "RSMA President",
      },
      {
        title: "Clerk of the Course",
        responsibilities:
          "The senior local official for a specific venue. Works under the Race Director to physically command the local Track Marshals, coordinate with local police & departments,...",
        reportsTo: "Race Director",
      },
      {
        title: "Race Marshal",
        responsibilities:
          "Securing pit lane access, retrieving crashed vehicles from ditches, and driving the Safety Car.",
        reportsTo: "Clerk of the Course",
      },
    ],
  },
  {
    name: "Media & Communications",
    positions: [
      {
        title: "Director of Communications (Department Head)",
        responsibilities:
          "Directs all public relations, official announcements, media credentialing, and oversees the broadcast and branding teams to maintain maximum immersion.",
        reportsTo: "RSMA President",
      },
      {
        title: "Lead Broadcaster",
        responsibilities: "Provides commentary on Euno Radio during races.",
        reportsTo: "Director of Communications",
      },
      {
        title: "Media Delegate",
        responsibilities:
          "Drafts official RSMA press releases, manages post-race media statements, and coordinates with local outlets to publish race recaps and driver controversy articles.",
        reportsTo: "Director of Communications",
      },
      {
        title: "Brand & Broadcast Designer",
        responsibilities:
          "Develops the visual identity of the RSMA. Creates broadcast overlays, graphics, circuit map posters, and official championship standings.",
        reportsTo: "Director of Communications",
      },
    ],
  },
];

export function WorkAtRSMA() {
  return (
    <Shell>
      <div className="r-panel">
        <div className="r-header">Work at the RSMA</div>
        <div style={{ padding: 8, display: "grid", gap: 8 }}>
          <div>
            To apply for a position at the RSMA, open a ticket in #contact-us on the RSMA Discord.
          </div>
          <div>
            Include your Roblox username, Discord username, the position(s) that interest you, your past experience, and whether you currently work in a racing team.
          </div>
          <div style={{ color: "var(--r-text-dim)" }}>
            Some positions will be merged together depending on the amount of applicants.
          </div>
          <button
            className="r-btn"
            style={{ width: 160 }}
            onClick={() => window.open(DISCORD_URL, "_blank", "noopener")}
          >
            RSMA Discord
          </button>
        </div>
      </div>
      {DEPARTMENTS.map((dept) => (
        <div className="r-panel" key={dept.name}>
          <div className="r-header">{dept.name}</div>
          <div style={{ padding: 8, display: "grid", gap: 12 }}>
            {dept.positions.map((pos) => (
              <div key={pos.title} style={{ display: "grid", gap: 2 }}>
                <div style={{ color: "var(--r-text)" }}>{pos.title}</div>
                <div style={{ color: "var(--r-text-dim)" }}>
                  Responsibilities: {pos.responsibilities}
                </div>
                <div style={{ color: "var(--r-text-dim)" }}>
                  Reports To: {pos.reportsTo}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Shell>
  );
}
