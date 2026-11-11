import { useCallback, useState } from "react";
import { Route, Routes } from "react-router-dom";
import type { Me } from "../shared/types";
import { MeContext } from "./me";
import { SignInHost } from "./access";
import type { BootData } from "./Boot";
import { FlagmanLayout, SiteLayout } from "./Layouts";
import { Home } from "./Home";
import { RacePage } from "./RacePage";
import { Privacy, Terms } from "./Legal";
import { DriverPage } from "./DriverPage";
import { StewardPage } from "./steward/StewardPage";
import { AdminPage } from "./admin/AdminPage";
import { TeamPage } from "./TeamPage";
import { MyTeamPage, MyTeamPicker } from "./MyTeam";
import { TeamRegistration } from "./TeamRegistration";
import { DriverRegistration } from "./DriverRegistration";
import { WorkAtRSMA } from "./WorkAtRSMA";
import { RegistrationPage } from "./RegistrationPage";
import { NotFound } from "./NotFound";
import { RaceRedirect } from "./RaceRedirect";

export function App() {
  const [data, setData] = useState<BootData | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const onData = useCallback((d: BootData) => {
    setMe(d.me);
    setData(d);
  }, []);

  return (
    <MeContext.Provider value={{ me, setMe }}>
      <SignInHost />
      <Routes>
        <Route element={<FlagmanLayout onData={onData} />}>
          <Route path="/session/:id/driver" element={<DriverPage />} />
          <Route path="/session/:id/steward" element={<StewardPage />} />
          <Route path="/session/:id/team/:teamId" element={<TeamPage />} />
        </Route>
        <Route element={<SiteLayout data={data} onData={onData} />}>
          <Route path="/" element={<Home />} />
          <Route path="/race/:id" element={<RaceRedirect />} />
          <Route path="/session/:id" element={<RacePage />} />
          <Route path="/session/:id/register" element={<RegistrationPage />} />
          <Route path="/driver-registration" element={<DriverRegistration />} />
          <Route path="/team-registration" element={<TeamRegistration />} />
          <Route path="/work-at-rsma" element={<WorkAtRSMA />} />
          <Route path="/my-team" element={<MyTeamPicker />} />
          <Route path="/my-team/:teamId" element={<MyTeamPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </MeContext.Provider>
  );
}
