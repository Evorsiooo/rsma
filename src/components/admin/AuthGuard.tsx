import { useState } from "react"
import { useAuthStore } from "@/store/authStore"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ChevronLeft } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"

export function AuthGuard({ children }: { children: React.ReactNode, requiredRole?: "ADMIN" | "RACE_CONTROL" }) {
  const { token, setToken } = useAuthStore()
  const [inputToken, setInputToken] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // In a real app we'd validate the token with the backend immediately
  // But for this frontend shell, we will just save it and let the backend reject requests.
  // We'll also allow optimistic rendering. If the backend returns 401 later, we can logout.

  const handleLogin = async () => {
    setLoading(true)
    setError("")
    // Let's do a quick check against the backend
    try {
      // We will check by trying to fetch the list of tokens (if ADMIN) 
      // or just assume it's good for now and rely on API responses.
      // Actually we can hit a dummy endpoint or just save it.
      // For now, save it, and we will decode role later if we implement a /me endpoint.
      // Actually we need the user to know their role or we don't care locally.
      setToken(inputToken, "UNKNOWN")
    } catch (e) {
      setError("Failed to login")
    }
    setLoading(false)
  }

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 relative">
        <div className="absolute top-4 left-4 right-4 flex justify-between items-center">
          <Button variant="ghost" onClick={() => window.location.href = "/"} className="gap-2">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <ThemeToggle />
        </div>

        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>Please enter your access token</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input 
                type="password" 
                placeholder="rsma_..." 
                value={inputToken} 
                onChange={e => setInputToken(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
              />
              {error && <p className="text-red-500 text-sm">{error}</p>}
            </div>
            <Button className="w-full" onClick={handleLogin} disabled={loading}>
              {loading ? "Verifying..." : "Login"}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}
