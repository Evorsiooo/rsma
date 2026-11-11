import { useLocation, useNavigate } from "react-router-dom";
import { SiteNotFound } from "./site/parts";

/** Not found: the Flagman screen inside Flagman pages, a box on the website. */
export function NotFound() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  if (!/^\/session\/[^/]+\/(driver|steward|team\/)/.test(pathname)) return <SiteNotFound />;
  return (
    <div className="r-screen">
      <div className="r-plate r-plate--xl" style={{ width: 240 }}>
        404
      </div>
      <div className="r-text">Page not found</div>
      <button className="r-btn" style={{ width: 140 }} onClick={() => nav("/")}>
        Home
      </button>
    </div>
  );
}
