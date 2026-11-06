import { useState } from "react";
import { Route, Routes } from "react-router-dom";
import type { Me, RaceSummary } from "../shared/types";
import { MeContext } from "./me";
import { Boot, type BootData } from "./Boot";
import { Home } from "./Home";
import { RacePage } from "./RacePage";
import { Privacy, Terms } from "./Legal";
import { DriverPage } from "./DriverPage";
import { StewardPage } from "./steward/StewardPage";
import { AdminPage } from "./admin/AdminPage";
import { NotFound } from "./NotFound";

export function App() {
  const [data, setData] = useState<BootData | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  if (!data)
    return (
      <Boot
        onReady={(d) => {
          setMe(d.me);
          setData(d);
        }}
      />
    );
  return (
    <MeContext.Provider value={{ me, setMe }}>
      <Routes>
        <Route path="/" element={<Home races={data.races} />} />
        <Route path="/race/:id" element={<RacePage />} />
        <Route path="/race/:id/driver" element={<DriverPage />} />
        <Route path="/race/:id/steward" element={<StewardPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MeContext.Provider>
  );
}
