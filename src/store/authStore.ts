import { create } from "zustand"
import { persist } from "zustand/middleware"

interface AuthState {
  token: string | null
  role: string | null
  setToken: (token: string, role?: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      role: null,
      setToken: (token, role) => set({ token, role: role || null }),
      logout: () => set({ token: null, role: null }),
    }),
    {
      name: "rsma-auth-storage",
    }
  )
)
