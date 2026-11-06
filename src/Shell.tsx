import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "./api";
import { useMe } from "./me";

export const VERSION = "v0.1.0";
export const DISCORD_URL = "https://discord.gg/29TEDUnRR7";

/** Top bar: brand link, optional left items, then the signed-in user or the sign-in button. */
export function Topbar({ children }: { children?: ReactNode }) {
  const { me, setMe } = useMe();
  const nav = useNavigate();
  return (
    <div className="r-topbar">
      <Link to="/" className="r-text" style={{ textDecoration: "none" }}>
        FLAGMAN
      </Link>
      {children}
      <div className="r-topbar__end">
        {me ? (
          <>
            {me.memberships.length > 0 && (
              <button className="r-btn" onClick={() => nav("/my-team")}>
                My Team
              </button>
            )}
            {me.roles.some((r) => r !== "steward") && (
              <button className="r-btn" onClick={() => nav("/admin")}>
                Admin
              </button>
            )}
            <span className="r-user">
              <span className="r-avatar">{me.username[0].toUpperCase()}</span>
              {me.username}
            </span>
            <button
              className="r-btn"
              onClick={async () => {
                await api.logout();
                setMe(null);
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <button className="r-btn" onClick={() => location.assign("/api/auth/roblox/login")}>
            Sign in with Roblox
          </button>
        )}
      </div>
    </div>
  );
}

/** Page shell for public pages: top bar, scrolling body, footer status line. */
export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="page">
      <Topbar />
      <div className="page__body">
        <div className={`page__col${wide ? " page__col--wide" : ""}`}>{children}</div>
      </div>
      <div className="r-statusbar">
        <a href={DISCORD_URL} target="_blank" rel="noreferrer">
          Discord
        </a>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <span className="r-statusbar__end">{VERSION}</span>
      </div>
    </div>
  );
}
