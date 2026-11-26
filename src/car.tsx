import { carText, type Run } from "../shared/race";

/** Title of the selected-car panel: the car of an endurance entry, the driver otherwise. */
export const carTitle = (r: Run) =>
  r.entry ? [r.number ? `#${r.number}` : "", carText(r)].filter(Boolean).join(" ") : [r.name, r.number ? `#${r.number}` : "", r.plate].filter(Boolean).join("  ");

/** Who is driving an endurance car and who is next: the driver on stage, and the first one queued for the car. */
export function CarDrivers({ runs, sel }: { runs: Run[]; sel: Run }) {
  if (!sel.entry) return null;
  const mine = runs.filter((r) => r.entry === sel.entry);
  const driving = mine.find((r) => r.status === "onstage");
  const next = mine.find((r) => r.status === "queued");
  return (
    <>
      {driving && <div className="r-log__line is-green">Driving {driving.name}</div>}
      {next && <div className="r-log__line is-dim">Next {next.name}</div>}
    </>
  );
}
