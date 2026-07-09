import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"

export default function Landing() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="max-w-3xl w-full text-center mb-12 mt-8">
        <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl mb-4">
          RSMA
        </h1>
        <p className="text-xl text-muted-foreground">
          Racing Session Management Application
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
        <Card className="flex flex-col h-full">
          <CardHeader>
            <CardTitle>Live Timing</CardTitle>
            <CardDescription>View the public real-time race timing board</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-end">
            <Button onClick={() => navigate("/tower")} className="w-full">
              Open Tower
            </Button>
          </CardContent>
        </Card>

        <Card className="flex flex-col h-full">
          <CardHeader>
            <CardTitle>Driver Radio</CardTitle>
            <CardDescription>Connect to your driver TTS and team radio</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-end">
            <Button onClick={() => navigate("/driver")} className="w-full">
              Connect Radio
            </Button>
          </CardContent>
        </Card>

        <Card className="flex flex-col h-full">
          <CardHeader>
            <CardTitle>Staff Portal</CardTitle>
            <CardDescription>Race control and admin dashboard</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-end">
            <Button onClick={() => navigate("/staff")} variant="secondary" className="w-full">
              Enter Portal
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
