import { useNavigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useRaceStore } from "@/store/raceStore"
import { ThemeToggle } from "@/components/theme-toggle"
import { ChevronLeft } from "lucide-react"
import { PressAudioWidget } from "@/components/PressAudioWidget"

export default function Tower() {
  const navigate = useNavigate()
  const { flagStatus, drivers, leaderboard } = useRaceStore()
  
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col p-4 relative">
      
      {/* Top Navigation */}
      <div className="absolute top-4 left-4 flex gap-4 items-start">
        <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
          <ChevronLeft className="w-4 h-4" /> Back
        </Button>
      </div>
      <div className="absolute top-4 right-4 flex items-start gap-4">
        <ThemeToggle />
      </div>

      {/* Flag Banner */}
      <div className="w-full flex justify-center mt-12 mb-10">
        {flagStatus === 'RED' ? (
          <div className="bg-red-600 text-white text-5xl py-4 px-12 rounded-xl uppercase font-black tracking-widest shadow-lg shadow-red-600/20">
            Red Flag
          </div>
        ) : flagStatus === 'YELLOW' ? (
          <div className="bg-yellow-500 text-white text-5xl py-4 px-12 rounded-xl uppercase font-black tracking-widest shadow-lg shadow-yellow-500/20">
            Yellow Flag
          </div>
        ) : (
          <div className="bg-green-600 text-white text-5xl py-4 px-12 rounded-xl uppercase font-black tracking-widest shadow-lg shadow-green-600/20">
            Green Flag
          </div>
        )}
      </div>

      <div className="w-full max-w-6xl mx-auto flex-1">
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px] text-center font-bold">POS</TableHead>
                <TableHead className="w-[80px] text-center font-bold">CAR</TableHead>
                <TableHead className="font-bold">DRIVER</TableHead>
                <TableHead className="text-right font-bold">LAPS</TableHead>
                <TableHead className="text-right font-bold">BEST/INT</TableHead>
                <TableHead className="text-right font-bold">GAP</TableHead>
                <TableHead className="text-right w-[100px] font-bold">STATUS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.map((username, i) => {
                const d = drivers[username]
                if (!d) return null
                return (
                  <TableRow key={username}>
                    <TableCell className="text-center font-mono font-bold text-lg">{i + 1}</TableCell>
                    <TableCell className="text-center font-mono">{d.number}</TableCell>
                    <TableCell className="font-semibold text-lg">{d.username}</TableCell>
                    <TableCell className="text-right font-mono">{d.lapsCompleted}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{d.intervalToAhead ?? '-'}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{d.gapToLeader ?? '-'}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={d.status === "TRACK" ? "default" : "secondary"}>
                        {d.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
              {leaderboard.length === 0 && (
               <TableRow>
                 <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                   No drivers on track.
                 </TableCell>
               </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Widgets Row */}
        <div className="mt-6 flex flex-wrap gap-6 items-start justify-center">
          <PressAudioWidget />
          
          <div className="bg-card border rounded-md p-4 space-y-4 shadow-sm w-80 flex flex-col justify-center">
            <div className="flex items-center gap-2 font-semibold">
              Listen to the live commentary on Euno Radio
            </div>
            <Button 
              className="w-full h-12 text-sm font-bold bg-purple-600 hover:bg-purple-700 text-white"
              onClick={() => window.open('https://euno.cc/', '_blank')}
            >
              Open Euno Radio
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
