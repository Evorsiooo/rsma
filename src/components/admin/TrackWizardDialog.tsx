import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRaceStore } from "@/store/raceStore"
import { useSensorDebuggerStore } from "@/store/sensorDebuggerStore"

export function TrackWizardDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { updateTrackLayout } = useRaceStore()
  const { recordedHits, setIsRecording, clearHits } = useSensorDebuggerStore()
  
  const [step, setStep] = useState(0)
  const [username, setUsername] = useState("")
  const [pitSensors, setPitSensors] = useState<number[]>([])
  const [trackSensors, setTrackSensors] = useState<number[]>([])

  useEffect(() => {
    if (!open) {
      setStep(0)
      setUsername("")
      setPitSensors([])
      setTrackSensors([])
      setIsRecording(false)
      clearHits()
    }
  }, [open, setIsRecording, clearHits])

  useEffect(() => {
    if (step === 1) {
      // Pitlane mapping: need 3 distinct sensors
      const userHits = recordedHits.filter(h => h.username === username).sort((a, b) => a.timestamp - b.timestamp)
      const unique = Array.from(new Set(userHits.map(h => h.sensorId)))
      
      if (unique.length > pitSensors.length) {
        setPitSensors(unique.slice(0, 3))
      }

      if (unique.length >= 3) {
        setStep(2)
        clearHits() // Clear for next step
      }
    } else if (step === 2) {
      // Track mapping: need full loop
      const userHits = recordedHits.filter(h => h.username === username).sort((a, b) => a.timestamp - b.timestamp)
      
      let newSequence: number[] = []
      let loopComplete = false

      for (const hit of userHits) {
        if (newSequence.length === 0) {
          newSequence.push(hit.sensorId)
        } else {
          const lastAdded = newSequence[newSequence.length - 1]
          if (hit.sensorId !== lastAdded) {
            // New distinct sensor
            if (hit.sensorId === newSequence[0]) {
              loopComplete = true
              break
            }
            newSequence.push(hit.sensorId)
          }
        }
      }

      setTrackSensors(newSequence)

      if (loopComplete) {
        setStep(3)
        setIsRecording(false)
      }
    }
  }, [recordedHits, step, username, pitSensors.length, clearHits, setIsRecording])

  const handleStartPitMapping = () => {
    if (!username.trim()) return
    setStep(1)
    clearHits()
    setIsRecording(true)
  }

  const handleFinish = () => {
    updateTrackLayout({
      sensors: trackSensors,
      pitlaneStartSensor: pitSensors[1] ?? null,
      postPitlaneSensor: pitSensors[2] ?? null
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Track Wizard</DialogTitle>
          <DialogDescription>
            Map the physical track sensors by driving through them in-game.
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Mapping Driver (Roblox Username)</Label>
              <Input 
                placeholder="Enter exact username" 
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-2">
                This driver must be in-game. The wizard will only listen to sensor hits from this username.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={handleStartPitMapping}>Next: Map Pitlane</Button>
            </DialogFooter>
          </div>
        )}

        {step === 1 && (
          <div className="py-4 space-y-4">
            <h3 className="font-semibold text-lg">Step 1: Pitlane Mapping</h3>
            <p className="text-sm text-muted-foreground">
              Please drive through the following sensors in exactly this order:
            </p>
            <ol className="list-decimal list-inside text-sm space-y-2">
              <li className={pitSensors.length >= 1 ? "line-through text-muted-foreground" : ""}>
                The sensor right <b>before</b> the pitlane entry.
              </li>
              <li className={pitSensors.length >= 2 ? "line-through text-muted-foreground" : ""}>
                The <b>pitlane entry</b> sensor itself.
              </li>
              <li className={pitSensors.length >= 3 ? "line-through text-muted-foreground" : ""}>
                The sensor right <b>after</b> the pitlane (where cars rejoin track).
              </li>
            </ol>
            <div className="text-xs bg-muted p-2 rounded">
              Sensors detected so far: {pitSensors.length}/3
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="py-4 space-y-4">
            <h3 className="font-semibold text-lg">Step 2: Full Track Loop</h3>
            <p className="text-sm text-muted-foreground">
              Drive through the entire course. Start at the sensor right after the finish line, and continue driving until you cross it again.
            </p>
            <div className="bg-muted p-4 rounded-md h-32 overflow-y-auto font-mono text-xs space-y-1">
              {trackSensors.length === 0 && <div className="text-muted-foreground">Waiting for first sensor...</div>}
              {trackSensors.map((id, idx) => (
                <div key={`${id}-${idx}`}>[{idx}] Sensor ID: {id}</div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="py-4 space-y-4">
            <h3 className="font-semibold text-lg text-green-500">Mapping Complete!</h3>
            <p className="text-sm text-muted-foreground">
              Successfully mapped {trackSensors.length} track sensors and identified the pitlane routing.
            </p>
            <DialogFooter>
              <Button onClick={handleFinish}>Save Track Layout</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
