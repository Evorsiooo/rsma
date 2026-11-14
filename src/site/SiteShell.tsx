import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { startSignIn } from "../access";
import { api } from "../api";
import { useMe } from "../me";
import { ownedTeams } from "../regUi";
import { DISCORD_URL } from "../Shell";

const today = new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

/** The RSMA website frame: utility bar, header, tabs, page, footer. */
export function SiteShell({ children }: { children: ReactNode }) {
  const { me, setMe } = useMe();
  const { pathname } = useLocation();
  const staff = !!me && me.roles.some((r) => r !== "steward");
  const team = !!me && me.memberships.length > 0;
  const owner = ownedTeams(me).length > 0;
  // The tab carries the team's name; several teams share "My Teams". A long name is cut short, the full name is its tooltip.
  const teamLabel = me && me.memberships.length === 1 ? me.memberships[0].name : "My Teams";
  // Team session registration belongs to the My Team tab; timing pages to Home.
  const onTeam = pathname.startsWith("/my-team") || /^\/(session|race)\/[^/]+\/register$/.test(pathname);
  const tab = (to: string, label: ReactNode, on?: boolean, cls?: string, title?: string) => (
    <NavLink to={to} end title={title} className={({ isActive }) => `${cls ?? ""}${(on ?? isActive) ? " on" : ""}`}>
      {label}
    </NavLink>
  );
  return (
    <div className="site">
      <div className="wrap">
        <div className="util">
          <span>{today.format(new Date())}</span>
          <span>
            {me ? (
              <>
                Signed in as <b>{me.username}</b>
                <button
                  className="lnk"
                  onClick={async () => {
                    await api.logout();
                    setMe(null);
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <button className="lnk" onClick={() => startSignIn(pathname)}>Sign in</button>
            )}
          </span>
        </div>
        <div className="hdr">
          <Link className="logo" to="/" aria-label="RSMA, Ro-State Motorsport Association">
            <img src="/brand/logo_white.png" alt="RSMA, Ro-State Motorsport Association" width={250} height={120} />
          </Link>
        </div>
        <div className="chk" />
        <nav className="tabs">
          {tab("/", "Home", pathname === "/" || pathname.startsWith("/race/") || (pathname.startsWith("/session/") && !onTeam))}
          {tab("/schedule", "Schedule")}
          {tab("/driver-registration", "Become a Driver")}
          {!owner && tab("/team-registration", "Team Registration")}
          {tab("/work-at-rsma", "Work at the RSMA")}
          <span className="sp" />
          {team && tab("/my-team", <span style={{ display: "inline-block", maxWidth: "16ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{teamLabel}</span>, onTeam, undefined, teamLabel)}
          {staff && tab("/admin", "Admin", pathname.startsWith("/admin"), "staff")}
        </nav>
        <main className="main">
          <div className="cols">
            <div className="stack">{children}</div>
          </div>
        </main>
        <div className="chk" />
        <div className="foot">
          <span>
            <img src="/brand/mark_blue.png" alt="RSMA" width={76} height={22} />
            &copy; {new Date().getFullYear()} Ro-State Motorsport Association
          </span>
          <span>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <a href={DISCORD_URL} target="_blank" rel="noreferrer">Discord</a>
          </span>
        </div>
      </div>
    </div>
  );
}
