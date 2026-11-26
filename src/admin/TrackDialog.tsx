import { useEffect, useState } from "react";
import type { TrackListItem } from "../../shared/track";
import type { AdminRace } from "../../shared/types";
import { admin } from "../api";
import { Dialog, toast } from "../ui";
import { TrackEditor } from "./TrackEditor";

/** Picks the track an event runs on, and opens the editor for new and saved tracks. */
export function TrackDialog({ race, onChange, onClose }: { race: AdminRace; onChange: () => void; onClose: () => void }) {
  const [list, setList] = useState<TrackListItem[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [sure, setSure] = useState(false);
  const reload = () => admin.tracks().then(setList, () => toast("Could not load the tracks."));
  useEffect(() => {
    reload();
  }, []);

  const pick = async (trackId: string | null) => {
    setSure(false);
    const r = await admin.patchRace(race.id, { trackId });
    if (!r.ok) return toast("Could not set the track.");
    onChange();
  };
  const cur = list?.find((t) => t.id === race.trackId) ?? null;
  const del = async () => {
    if (!cur) return;
    if (!sure) return setSure(true);
    const r = await admin.deleteTrack(cur.id);
    setSure(false);
    if (!r.ok) return toast(r.error === "in_use" ? "An event still uses this track." : "Could not delete the track.");
    toast("Track deleted.", "green");
    reload();
  };

  return (
    <>
      <Dialog
        title={`Track: ${race.name}`}
        size="s"
        onClose={onClose}
        foot={
          <>
            <button className="r-btn" onClick={() => setEditing({ id: null })}>New track</button>
            <button className="r-btn" disabled={!cur} onClick={() => cur && setEditing({ id: cur.id })}>Edit track</button>
            <button className="r-btn" onClick={onClose}>Close</button>
          </>
        }
      >
        {!list ? null : (
          <>
            <div className="r-select">
              <select aria-label="Track" value={race.trackId ?? ""} onChange={(e) => pick(e.target.value || null)}>
                <option value="">No track</option>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.segments} segments, {t.turns} turns)
                  </option>
                ))}
              </select>
            </div>
            {cur && (
              <div className="r-row" style={{ alignItems: "center" }}>
                <span className="r-text r-fill">Used by {cur.events} {cur.events === 1 ? "event" : "events"}</span>
                <button className="r-btn r-cell--red" style={{ width: 120 }} disabled={cur.events > 0} onClick={del}>{sure ? "Confirm delete" : "Delete track"}</button>
              </div>
            )}
          </>
        )}
      </Dialog>
      {editing && (
        <TrackEditor
          trackId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={async (id) => {
            setEditing(null);
            if (editing.id === null) await pick(id);
            reload();
            onChange();
          }}
        />
      )}
    </>
  );
}
