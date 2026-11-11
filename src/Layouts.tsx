import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Boot, type BootData } from "./Boot";
import { SiteBoot } from "./site/parts";
import { SiteShell } from "./site/SiteShell";

/** Data fetched at start-up, shared by the website pages. */
const DataContext = createContext<BootData | null>(null);
export const useBootData = () => useContext(DataContext);

/** Switches the page between website and Flagman looks: body class, title and tab icon. */
function useMode(site: boolean) {
  useEffect(() => {
    document.documentElement.classList.toggle("is-site", site);
    document.body.classList.toggle("is-site", site);
    document.title = site ? "RSMA" : "Flagman";
    const icon = document.getElementById("icon") as HTMLLinkElement | null;
    if (icon) {
      icon.type = site ? "image/png" : "image/svg+xml";
      icon.href = site ? "/rsma-icon.png" : "/favicon.svg";
    }
  }, [site]);
}

/** The RSMA website: shell around every page, a loading box until the first data arrives. */
export function SiteLayout({ data, onData }: { data: BootData | null; onData: (d: BootData) => void }) {
  useMode(true);
  const { pathname } = useLocation();
  const legal = pathname === "/terms" || pathname === "/privacy";
  const body = !data && !legal ? <SiteBoot onReady={onData} /> : <Outlet />;
  return (
    <DataContext.Provider value={data}>
      <SiteShell>{body}</SiteShell>
    </DataContext.Provider>
  );
}

/** Flagman: the standalone software (steward, team and driver pages). It shows its own loading screen each time it is opened. */
export function FlagmanLayout({ onData }: { onData: (d: BootData) => void }) {
  useMode(false);
  const [ready, setReady] = useState(false);
  const done = useCallback(
    (d: BootData) => {
      onData(d);
      setReady(true);
    },
    [onData],
  );
  if (!ready) return <Boot onReady={done} minMs={900} />;
  return <Outlet />;
}
