import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { useRaceStore } from "@/store/raceStore"
import { ThemeToggle } from "@/components/theme-toggle"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { TrackWizardDialog } from "@/components/admin/TrackWizardDialog"
import { useSensorDebuggerStore } from "@/store/sensorDebuggerStore"

export default function Admin() {
  const { whitelist, hardResetState } = useRaceStore()
  const { isRecording, setIsRecording, recordedHits, clearHits } = useSensorDebuggerStore()
  
  const [newDriverNum, setNewDriverNum] = useState("")
  const [newDriverName, setNewDriverName] = useState("")
  const [wizardOpen, setWizardOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  const toggleRecording = () => {
    if (!isRecording) {
      clearHits()
      setIsRecording(true)
    } else {
      setIsRecording(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground">Manage system operations and driver whitelists</p>
        </div>
        <ThemeToggle />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>System Operations</CardTitle>
            <CardDescription>Dangerous or core system controls</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 grid md:grid-cols-2 gap-4">
            <Button variant="outline" className="w-full justify-start mt-4" onClick={() => setWizardOpen(true)}>
              Start Track Wizard
            </Button>
            
            <Button variant="destructive" className="w-full justify-start mt-4" onClick={() => setResetOpen(true)}>
              Reset Global State
            </Button>

            <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete all driver states, whitelists, logs, and track configurations, completely wiping the application database.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { hardResetState(); setResetOpen(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Yes, reset everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Driver Whitelist</CardTitle>
          <CardDescription>Drivers authorized to connect to the session</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-2 mb-6">
            <div className="w-24">
              <Input placeholder="Car #" value={newDriverNum} onChange={e => setNewDriverNum(e.target.value)} />
            </div>
            <div className="flex-1">
              <Input placeholder="Driver Name" value={newDriverName} onChange={e => setNewDriverName(e.target.value)} />
            </div>
            <Button>Add Driver</Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Car #</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {whitelist.map((w) => (
                  <TableRow key={w.username}>
                    <TableCell className="font-medium font-mono">{w.number}</TableCell>
                    <TableCell>{w.username}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="destructive" size="sm">Remove</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {whitelist.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground h-24">
                      No drivers whitelisted
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Record Sensor Data</CardTitle>
            <CardDescription>Listen to raw incoming webhook hits for physical sensor debugging</CardDescription>
          </div>
          <Button variant={isRecording ? "destructive" : "default"} onClick={toggleRecording}>
            {isRecording ? "Stop Recording" : "Start Recording"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="bg-muted rounded-md h-[300px] overflow-y-auto p-4 font-mono text-xs space-y-1">
            {recordedHits.length === 0 && (
              <div className="text-muted-foreground italic">No sensor data recorded. Waiting for hits...</div>
            )}
            {recordedHits.map((hit, idx) => (
              <div key={idx} className="flex gap-4 border-b border-border/50 pb-1 last:border-0">
                <span className="text-muted-foreground w-24">[{new Date(hit.timestamp).toLocaleTimeString()}]</span>
                <span className="font-semibold text-primary w-32">{hit.username}</span>
                <span>Hit Sensor ID: {hit.sensorId}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <TrackWizardDialog open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  )
}
