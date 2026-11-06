import { useState } from "react";
import { Route, Routes } from "react-router-dom";
import type { RaceSummary } from "../shared/types";
import { Boot } from "./Boot";
import { Home } from "./Home";
import { RacePage } from "./RacePage";
import { NotFound } from "./NotFound";

export function App() {
  const [races, setRaces] = useState<RaceSummary[] | null>(null);
  if (!races) return <Boot onReady={setRaces} />;
  return (
    <Routes>
      <Route path="/" element={<Home races={races} />} />
      <Route path="/race/:id" element={<RacePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
