import { lazy, Suspense, useCallback, useState } from "react";
import { Route, Routes } from "react-router-dom";
import type { Me } from "../shared/types";
import { MeContext } from "./me";
import { SignInHost } from "./access";
import type { BootData } from "./Boot";
import { FlagmanLayout, SiteLayout } from "./Layouts";
import { Home } from "./Home";
import { RacePage } from "./RacePage";
import { Privacy, Terms } from "./Legal";
import { MyTeamPage, MyTeamPicker } from "./MyTeam";
import { Schedule } from "./Schedule";
import { TeamRegistration } from "./TeamRegistration";
import { DriverRegistration } from "./DriverRegistration";
import { WorkAtRSMA } from "./WorkAtRSMA";
import { EventRegistration, RegisterRedirect } from "./EventRegistration";
import { NotFound } from "./NotFound";
import { RaceRedirect } from "./RaceRedirect";

// Pages most visitors never open are separate downloads. The one this address needs starts downloading at once.
const load = {
  driver: () => import("./DriverPage").then((m) => ({ default: m.DriverPage })),
  steward: () => import("./steward/StewardPage").then((m) => ({ default: m.StewardPage })),
  team: () => import("./TeamPage").then((m) => ({ default: m.TeamPage })),
  admin: () => import("./admin/AdminPage").then((m) => ({ default: m.AdminPage })),
};
const DriverPage = lazy(load.driver);
const StewardPage = lazy(load.steward);
const TeamPage = lazy(load.team);
const AdminPage = lazy(load.admin);
const at = location.pathname;
if (/^\/session\/[^/]+\/driver$/.test(at)) void load.driver();
else if (/^\/session\/[^/]+\/steward$/.test(at)) void load.steward();
else if (/^\/session\/[^/]+\/team\//.test(at)) void load.team();
else if (at === "/admin" || at.startsWith("/admin/")) void load.admin();

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
          <Route path="/session/:id/driver" element={<Suspense fallback={null}><DriverPage /></Suspense>} />
          <Route path="/session/:id/steward" element={<Suspense fallback={null}><StewardPage /></Suspense>} />
          <Route path="/session/:id/team/:teamId" element={<Suspense fallback={null}><TeamPage /></Suspense>} />
        </Route>
        <Route element={<SiteLayout data={data} onData={onData} />}>
          <Route path="/" element={<Home />} />
          <Route path="/race/:id" element={<RaceRedirect />} />
          <Route path="/session/:id" element={<RacePage />} />
          <Route path="/race/:id/register" element={<EventRegistration />} />
          <Route path="/session/:id/register" element={<RegisterRedirect />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/driver-registration" element={<DriverRegistration />} />
          <Route path="/team-registration" element={<TeamRegistration />} />
          <Route path="/work-at-rsma" element={<WorkAtRSMA />} />
          <Route path="/my-team" element={<MyTeamPicker />} />
          <Route path="/my-team/:teamId" element={<MyTeamPage />} />
          <Route path="/admin" element={<Suspense fallback={<div className="note">Loading...</div>}><AdminPage /></Suspense>} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </MeContext.Provider>
  );
}
