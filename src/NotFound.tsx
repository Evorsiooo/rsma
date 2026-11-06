import { useNavigate } from "react-router-dom";

export function NotFound() {
  const nav = useNavigate();
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
