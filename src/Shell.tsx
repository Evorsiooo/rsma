import type { ReactNode } from "react";
import { startSignIn } from "./access";
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
        <button className="r-btn" onClick={() => nav("/")}>
          Back to RSMA Website
        </button>
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
          <button className="r-btn" onClick={() => startSignIn("/")}>
            Sign in
          </button>
        )}
      </div>
    </div>
  );
}
