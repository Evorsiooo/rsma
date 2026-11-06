import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export const VERSION = "v0.1.0";

/** Page shell for public pages: top bar, scrolling body, footer status line. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="page">
      <div className="r-topbar">
        <Link to="/" className="r-text" style={{ textDecoration: "none" }}>
          FLAGMAN
        </Link>
        <div className="r-topbar__end">
          {/* Enabled in the sign-in step. */}
          <button className="r-btn" disabled>
            Sign in with Roblox
          </button>
        </div>
      </div>
      <div className="page__body">
        <div className="page__col">{children}</div>
      </div>
      <div className="r-statusbar">
        <a href="https://discord.gg/29TEDUnRR7" target="_blank" rel="noreferrer">
          Discord
        </a>
        <span className="r-statusbar__end">{VERSION}</span>
      </div>
    </div>
  );
}
