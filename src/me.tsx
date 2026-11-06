import { createContext, useContext } from "react";
import type { Me } from "../shared/types";

export const MeContext = createContext<{ me: Me | null; setMe: (m: Me | null) => void }>({ me: null, setMe: () => {} });
export const useMe = () => useContext(MeContext);
