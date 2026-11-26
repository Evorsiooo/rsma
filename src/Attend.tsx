import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ATTENDANCE_LABEL, type AttendanceStatus, type AttendanceView } from "../shared/attendance";
import { startSignIn } from "./access";
import { attendanceApi } from "./api";
import { useMe } from "./me";
import { NotFound } from "./NotFound";
import { fmtWhen } from "./regUi";
import { Bd, Box } from "./site/parts";
import { toast } from "./ui";

const ERRORS: Record<string, string> = {
  not_open: "Attendance is not open yet.",
  closed: "Attendance has closed.",
  attendance_off: "This session does not take attendance.",
  not_eligible: "You are not In for this session.",
  unauthorized: "Sign in first.",
  network: "Could not reach the server. Check your connection.",
};

/** /attend/:sessionId: the link RSMA shares shortly before a session. Drivers sign in with Roblox and confirm they are here. */
export function Attend() {
  const { id = "" } = useParams();
  const { me } = useMe();
  const [v, setV] = useState<AttendanceView | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(() => attendanceApi.get(id).then(setV, () => setV(null)), [id]);
  useEffect(() => {
    load();
  }, [load, me?.id]);
  // The page moves from "opens at" to the button by itself.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      if (v && v.enabled && v.phase === "upcoming" && v.opensAt != null && Date.now() >= v.opensAt) load();
    }, 1000);
    return () => clearInterval(t);
  }, [v, load]);
  const answer = async (status: AttendanceStatus) => {
    const prev = v;
    setV((x) => (x ? { ...x, status } : x));
    const r = await attendanceApi.answer(id, status);
    if (!r.ok) {
      setV(prev);
      toast(ERRORS[r.error] ?? "Request failed.");
    }
    load();
  };
  if (v === null) return <NotFound />;
  if (v === undefined) return null;
  const open = v.enabled && v.phase === "open" && now >= (v.opensAt ?? 0) && now < (v.closesAt ?? 0);
  return (
    <Box title={`Attendance · ${v.raceName} · ${v.sessionName}`}>
      <Bd>Session starts {fmtWhen(v.startsAt)}.</Bd>
      {!v.enabled && <Bd top><div className="mute">This session does not take attendance.</div></Bd>}
      {v.enabled && v.phase === "upcoming" && <Bd top><div className="mute">Attendance opens {fmtWhen(v.opensAt!)}.</div></Bd>}
      {v.enabled && v.phase === "closed" && <Bd top><div className="mute">Attendance has closed.{v.status ? ` You answered ${ATTENDANCE_LABEL[v.status].toLowerCase()}.` : " You have no answer, so you are absent."}</div></Bd>}
      {v.enabled && !me && (
        <Bd top bar>
          <span className="mute" style={{ flex: 1 }}>Sign in with Roblox to confirm you are here.</span>
          <button className="btn pri" onClick={() => startSignIn(`/attend/${id}`)}>Sign in</button>
        </Bd>
      )}
      {v.enabled && me && !v.eligible && v.phase !== "off" && (
        <Bd top>
          <div className="mute">
            {v.why === "not_in" ? "You are registered but not In for this session, so there is nothing to confirm." : "You are not registered as a driver for this session."}
          </div>
        </Bd>
      )}
      {v.enabled && me && v.eligible && (
        <>
          <Bd top>
            <div>
              <b>{me.username}</b>
              {v.team ? ` · ${v.team}` : " · Independent"}
            </div>
            <div className="mute" style={{ marginTop: 4 }}>Status: {ATTENDANCE_LABEL[v.status ?? "none"]}</div>
          </Bd>
          {open && (
            <Bd top bar>
              <button className="btn pri" disabled={v.status === "present"} onClick={() => answer("present")}>I am here</button>
              <button className="btn red" disabled={v.status === "absent"} onClick={() => answer("absent")}>I cannot make it</button>
            </Bd>
          )}
          {open && <Bd top><div className="mute">Closes {fmtWhen(v.closesAt!)}. Without an answer you are absent and are not staged.</div></Bd>}
        </>
      )}
    </Box>
  );
}
