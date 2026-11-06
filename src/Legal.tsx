import { Shell } from "./Shell";

interface Section {
  title: string;
  lines: string[];
}

const UPDATED = "6 November 2026";

const PRIVACY: Section[] = [
  {
    title: "What we store",
    lines: [
      "When you sign in with Roblox: your Roblox user ID, username and display name. We never see your Roblox password.",
      "Event data entered by staff: driver names, plates, times, penalties, flags and radio messages.",
    ],
  },
  {
    title: "Cookies",
    lines: ["One cookie keeps you signed in. We use no analytics or advertising cookies."],
  },
  {
    title: "Who can see it",
    lines: [
      "Event pages are public: anyone can see driver names, plates, times and penalties.",
      "Your Roblox profile data is visible only to staff with user management access.",
      "We do not sell or share data. The site runs on Cloudflare.",
    ],
  },
  {
    title: "Removal",
    lines: ["To have your account or results removed, contact staff on Discord."],
  },
];

const TERMS: Section[] = [
  {
    title: "Use",
    lines: [
      "Anyone can view events. Staff tools need a Roblox sign-in and a role granted by an admin.",
      "Do not interfere with the site, attempt to access tools you have no role for, or send abusive radio messages.",
    ],
  },
  {
    title: "Results",
    lines: ["Times, penalties and rankings are decided by the event stewards. Their decisions are final for the event."],
  },
  {
    title: "Access",
    lines: ["Staff roles can be removed at any time. The site is provided as is, without any guarantee of availability."],
  },
  {
    title: "Roblox",
    lines: ["This site is not affiliated with or endorsed by Roblox Corporation."],
  },
];

function LegalPage({ title, sections }: { title: string; sections: Section[] }) {
  return (
    <Shell>
      <div className="r-panel">
        <div className="r-header">{title}</div>
        <div className="r-log r-log--wrap">
          <div className="r-log__line is-dim">Last updated {UPDATED}</div>
        </div>
      </div>
      {sections.map((s) => (
        <div className="r-panel" key={s.title}>
          <div className="r-header">{s.title}</div>
          <div className="r-log r-log--wrap">
            {s.lines.map((l) => (
              <div className="r-log__line" key={l}>
                {l}
              </div>
            ))}
          </div>
        </div>
      ))}
    </Shell>
  );
}

export const Terms = () => <LegalPage title="Terms of service" sections={TERMS} />;
export const Privacy = () => <LegalPage title="Privacy policy" sections={PRIVACY} />;
