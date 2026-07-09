import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRaceStore, type SessionType } from "@/store/raceStore"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "@/components/theme-toggle"
import { PenaltyCheatSheet } from "@/components/penalty-cheat-sheet"
import { playStartSequence } from "@/lib/audio"
import { Simulator } from "@/lib/simulator"
import { useAuthStore } from "@/store/authStore"

export default function Steward() {
  const { flagStatus, setFlagStatus, sessionType, setSessionType, drivers, leaderboard, sensorsActive, setSensorsActive, setSessionTimes, addLog, sessionStartTime, sessionEndTime, lapCount, endSessionEarly, logs, toggleDriverDnf } = useRaceStore()
  const driverList = Object.values(drivers)
  const { logout } = useAuthStore()

  const [commsTargets, setCommsTargets] = useState<string[]>([])
  const [dnfTarget, setDnfTarget] = useState<string>("")
  
  // Local states for inputs since they might not be in the store yet
  const [totalTime, setTotalTime] = useState(60)
  const [totalLaps, setTotalLaps] = useState(lapCount)
  const [messageText, setMessageText] = useState("")
  const [timeLeftStr, setTimeLeftStr] = useState("00:00:00")
  const [lapsLeft, setLapsLeft] = useState(lapCount)

  const isSessionActive = sessionStartTime !== null && 
    (sessionType === 'RACE' 
      ? !(leaderboard.length > 0 && drivers[leaderboard[0]]?.status === 'FINISHED') 
      : (sessionEndTime !== null && sessionEndTime > Date.now()));

  const formatMs = (ms: number | null) => {
    if (ms === null || ms === 0) return '-';
    return `+${(ms / 1000).toFixed(3)}`;
  };

  useEffect(() => {
    if (sensorsActive) {
      Simulator.start();
    } else {
      Simulator.stop();
    }
  }, [sensorsActive])

  useEffect(() => {
    const interval = setInterval(() => {
      if (sessionStartTime && sessionEndTime && sessionType !== 'RACE') {
         const remainingMs = Math.max(0, sessionEndTime - Date.now());
         const hrs = Math.floor(remainingMs / 3600000);
         const mins = Math.floor((remainingMs % 3600000) / 60000);
         const secs = Math.floor((remainingMs % 60000) / 1000);
         setTimeLeftStr(`${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      } else if (sessionType === 'RACE') {
         const leader = leaderboard.length > 0 ? drivers[leaderboard[0]] : null;
         if (leader) {
             setLapsLeft(Math.max(0, lapCount - leader.lapsCompleted));
         } else {
             setLapsLeft(lapCount);
         }
      } else {
         setTimeLeftStr("00:00:00");
      }
    }, 500);
    return () => clearInterval(interval);
  }, [sessionStartTime, sessionEndTime, sessionType, leaderboard, drivers, lapCount]);

  const handleStartSession = () => {
    const now = Date.now();
    useRaceStore.getState().resetSessionLogsAndTiming();
    setSensorsActive(true); // Automatically toggle track sensors

    if (sessionType === 'RACE') {
       useRaceStore.getState().setLapCount(totalLaps);
       setSessionTimes(now, null);
       addLog({ timestamp: now, message: 'Race session started', type: 'SYSTEM' });
       
       useRaceStore.getState().sendRawEvent("START_SEQUENCE", { playAt: now + 2000 });
       
       playStartSequence(0.8, now + 2000);
    } else {
       setSessionTimes(now, now + (totalTime * 60000));
       addLog({ timestamp: now, message: `${sessionType} session started for ${totalTime} minutes`, type: 'SYSTEM' });
       
       useRaceStore.getState().sendRawEvent("TTS_MESSAGE", { targets: ["ALL"], text: `${sessionType.toLowerCase()} has started` });
    }
  };

  const handleEndSession = () => {
    endSessionEarly();
    setSessionTimes(null, null); // Clear start time to completely unlock UI
    addLog({ timestamp: Date.now(), message: 'Session ended early', type: 'SYSTEM' });
  };

  const handleDemoAudio = () => {
    playStartSequence(0.8)
    useRaceStore.getState().sendRawEvent("START_SEQUENCE", {})
  }

  const handleExportLogs = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `rsma_logs_${new Date().toISOString()}.json`);
    dlAnchorElem.click();
  };

  const handleSendMessage = () => {
    if (!messageText.trim() || commsTargets.length === 0) return
    const targets = commsTargets.length === driverList.length + 1 ? ["ALL"] : commsTargets;
    
    addLog({ timestamp: Date.now(), message: `Direct Comms to ${targets.join(', ')}: ${messageText.trim()}`, type: 'MESSAGE' });
    
    useRaceStore.getState().sendRawEvent("TTS_MESSAGE", { targets, text: messageText.trim() });
    setMessageText("")
  }
  
  const toggleDriverComms = (username: string) => {
    setCommsTargets(prev => 
      prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username]
    )
  }

  const toggleAllComms = () => {
    // "PRESS" should be considered in the "all drivers" check
    const allTargets = ["PRESS", ...driverList.map(d => d.username)]
    if (commsTargets.length === allTargets.length && allTargets.length > 0) {
      setCommsTargets([])
    } else {
      setCommsTargets(allTargets)
    }
  }

  const allTargetsCount = driverList.length + 1; // +1 for PRESS
  const allSelected = commsTargets.length === allTargetsCount && allTargetsCount > 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Race Control</h1>
          <p className="text-muted-foreground">Steward command center and live orchestration</p>
        </div>
        <div className="flex items-center space-x-4">
          <Badge className={`text-lg px-4 py-1 uppercase border-0 ${
            flagStatus === 'RED' ? 'bg-red-600 hover:bg-red-700 text-white' : 
            flagStatus === 'YELLOW' ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : 
            flagStatus === 'GREEN' ? 'bg-green-600 hover:bg-green-700 text-white' : ''
          }`}>
            {flagStatus} FLAG
          </Badge>
          <PenaltyCheatSheet />
          <ThemeToggle />
          <Button variant="ghost" onClick={logout}>Logout</Button>
        </div>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-12">
        
        {/* Left Column - Live Timing */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle>Live Timing Widget</CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">P</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead className="text-right">Best/Int</TableHead>
                    <TableHead className="text-right">Gap</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboard.slice(0, 8).map((username, i) => {
                    const d = drivers[username]
                    if (!d) return null
                    return (
                      <TableRow key={username}>
                        <TableCell className="font-mono">{i + 1}</TableCell>
                        <TableCell className="font-medium">{d.username}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatMs(d.intervalToAhead)}</TableCell>
                        <TableCell className="text-right font-mono font-bold">{formatMs(d.gapToLeader)}</TableCell>
                      </TableRow>
                    )
                  })}
                  {leaderboard.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No drivers active</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Controls and Logs */}
        <div className="lg:col-span-8 space-y-6 flex flex-col">
          
          {/* Top Row - Controls (3 columns) */}
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Global Flags & Sensors</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 flex-1 flex flex-col justify-between">
                <div className="grid grid-cols-3 gap-2">
                  <Button 
                    onClick={() => setFlagStatus('GREEN')}
                    className="bg-green-600 hover:bg-green-700 text-white h-12 font-bold px-0"
                  >GREEN</Button>
                  <Button 
                    onClick={() => setFlagStatus('YELLOW')}
                    className="bg-yellow-500 hover:bg-yellow-600 text-white h-12 font-bold px-0"
                  >YELLOW</Button>
                  <Button 
                    onClick={() => setFlagStatus('RED')}
                    className="bg-red-600 hover:bg-red-700 h-12 font-bold px-0 text-white"
                  >RED</Button>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between border-t pt-4">
                    <div className="space-y-0.5">
                      <div className="font-medium">Track Sensors</div>
                      <div className="text-sm text-muted-foreground">Enable timing loops</div>
                    </div>
                    <Switch checked={sensorsActive} onCheckedChange={setSensorsActive} />
                  </div>
                  <div className="flex items-center justify-between border-t pt-4">
                    <div className="space-y-0.5">
                      <div className="font-medium">Demo Audio</div>
                      <div className="text-sm text-muted-foreground">Play test sound</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleDemoAudio}>Play</Button>
                  </div>
                  
                  <div className="space-y-2 border-t pt-4">
                    <div className="space-y-0.5 mb-2">
                      <div className="font-medium">DNF</div>
                    </div>
                    <div className="flex gap-2">
                      <Select value={dnfTarget} onValueChange={(val) => { if (val) setDnfTarget(val) }}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select driver" />
                        </SelectTrigger>
                        <SelectContent>
                          {driverList.map(d => (
                            <SelectItem key={d.username} value={d.username}>
                              {d.username} {d.status === 'DNF' ? '(DNF)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button 
                        variant="destructive"
                        onClick={() => {
                          if (dnfTarget) {
                            toggleDriverDnf(dnfTarget);
                            const d = drivers[dnfTarget];
                            const newStatus = d?.status === 'DNF' ? 'TRACK' : 'DNF';
                            addLog({
                              timestamp: Date.now(),
                              message: `Steward marked ${dnfTarget} as ${newStatus}`,
                              type: 'SYSTEM'
                            });
                          }
                        }}
                      >
                        Toggle DNF
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle>Session Control</CardTitle>
                <CardDescription>Configure and run the session</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 flex-1">
                <Select value={sessionType} onValueChange={(val) => setSessionType(val as SessionType)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Session Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRACTICE">Practice</SelectItem>
                    <SelectItem value="QUALIFYING">Qualifying</SelectItem>
                    <SelectItem value="RACE">Race</SelectItem>
                  </SelectContent>
                </Select>

                <div className="pt-2">
                  {(sessionType === 'PRACTICE' || sessionType === 'QUALIFYING') ? (
                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-medium text-muted-foreground mb-1">Total Time (mins)</div>
                        <Input type="number" value={totalTime} onChange={e => setTotalTime(Number(e.target.value))} disabled={isSessionActive} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground mb-1">Time Remaining</div>
                        <div className="text-3xl font-black font-mono">{timeLeftStr}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-medium text-muted-foreground mb-1">Total Laps</div>
                        <Input type="number" value={totalLaps} onChange={e => setTotalLaps(Number(e.target.value))} disabled={isSessionActive} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-muted-foreground mb-1">Laps Remaining</div>
                        <div className="text-3xl font-black font-mono">{lapsLeft}</div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex space-x-2 border-t pt-4 mt-auto">
                <Button className="flex-1" onClick={handleStartSession} disabled={isSessionActive}>Start Session</Button>
                <Button variant="destructive" className="flex-1" onClick={handleEndSession} disabled={!isSessionActive}>End</Button>
              </CardFooter>
            </Card>

            <Card className="flex flex-col md:col-span-2 xl:col-span-1 border-dashed">
              <CardHeader>
                <CardTitle className="text-muted-foreground">Empty Module</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 flex-1 flex flex-col items-center justify-center text-sm text-muted-foreground">
                <div className="border border-dashed p-4 rounded-xl w-full h-full flex items-center justify-center bg-muted/50">
                  Reserved for Future Feature
                </div>
              </CardContent>
            </Card>

          </div>

          {/* Middle Row - Direct Comms (Full Width) */}
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Direct Comms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 flex-1 flex flex-col">
              <div className="flex flex-wrap gap-2">
                <Badge 
                  variant={allSelected ? "default" : "outline"} 
                  className="cursor-pointer" 
                  onClick={toggleAllComms}
                >
                  ALL DRIVERS
                </Badge>
                <Badge 
                  variant={commsTargets.includes("PRESS") ? "default" : "outline"} 
                  className="cursor-pointer" 
                  onClick={() => toggleDriverComms("PRESS")}
                >
                  PRESS
                </Badge>
                {driverList.map(d => (
                  <Badge 
                    key={d.username}
                    variant={commsTargets.includes(d.username) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleDriverComms(d.username)}
                  >
                    #{d.number} {d.username}
                  </Badge>
                ))}
                {driverList.length === 0 && (
                  <span className="text-sm text-muted-foreground italic">No drivers available</span>
                )}
              </div>
              <div className="flex gap-4 items-end mt-2">
                <Textarea 
                  placeholder="Enter message to broadcast..." 
                  className="resize-none flex-1 h-12" 
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                />
                <Button className="w-40 h-12 shrink-0" onClick={handleSendMessage}>Send Message</Button>
              </div>
            </CardContent>
          </Card>

          {/* Bottom Row - System Logs (Full Width of Right Column) */}
          <Card className="flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle>System Logs</CardTitle>
              <Button variant="outline" size="sm" onClick={handleExportLogs}>Export JSON Log</Button>
            </CardHeader>
            <CardContent className="pt-2">
              <Tabs defaultValue="race" className="flex flex-col">
                <TabsList className="w-[300px] shrink-0">
                  <TabsTrigger value="practice" className="flex-1">Practice</TabsTrigger>
                  <TabsTrigger value="quali" className="flex-1">Qualifying</TabsTrigger>
                  <TabsTrigger value="race" className="flex-1">Race</TabsTrigger>
                </TabsList>
                <TabsContent value="practice" className="mt-0">
                  <div className="bg-muted mt-2 rounded-md h-[250px] p-4 overflow-y-auto font-mono text-sm text-muted-foreground space-y-1">
                    {logs.PRACTICE.length === 0 && <div>No logs recorded for this session.</div>}
                    {logs.PRACTICE.map(log => (
                      <div key={log.id}>[{new Date(log.timestamp).toLocaleTimeString()}] {log.message}</div>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="quali" className="mt-0">
                  <div className="bg-muted mt-2 rounded-md h-[250px] p-4 overflow-y-auto font-mono text-sm text-muted-foreground space-y-1">
                    {logs.QUALIFYING.length === 0 && <div>No logs recorded for this session.</div>}
                    {logs.QUALIFYING.map(log => (
                      <div key={log.id}>[{new Date(log.timestamp).toLocaleTimeString()}] {log.message}</div>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="race" className="mt-0">
                  <div className="bg-muted mt-2 rounded-md h-[250px] p-4 overflow-y-auto font-mono text-sm text-muted-foreground space-y-1">
                    {logs.RACE.length === 0 && <div>No logs recorded for this session.</div>}
                    {logs.RACE.map(log => (
                      <div key={log.id}>[{new Date(log.timestamp).toLocaleTimeString()}] {log.message}</div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  )
}
