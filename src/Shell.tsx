import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useMe } from "./me";

export const VERSION = "v0.1.0";

/** Top bar: brand link, optional left items, then the signed-in user or the sign-in button. */
export function Topbar({ children }: { children?: ReactNode }) {
  const { me, setMe } = useMe();
  return (
    <div className="r-topbar">
      <Link to="/" className="r-text" style={{ textDecoration: "none" }}>
        FLAGMAN
      </Link>
      {children}
      <div className="r-topbar__end">
        {me ? (
          <>
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
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="page">
      <Topbar />
      <div className="page__body">
        <div className="page__col">{children}</div>
      </div>
      <div className="r-statusbar">
        <a href="https://discord.gg/29TEDUnRR7" target="_blank" rel="noreferrer">
          Discord
        </a>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <span className="r-statusbar__end">{VERSION}</span>
      </div>
    </div>
  );
}
