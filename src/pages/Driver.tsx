import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { useRaceStore } from "@/store/raceStore"
import { ThemeToggle } from "@/components/theme-toggle"
import { ChevronLeft } from "lucide-react"
import { playStartSequence } from "@/lib/audio"

export default function Driver() {
  const navigate = useNavigate()
  const { drivers } = useRaceStore()
  const driverList = Object.values(drivers)
  
  const [connected, setConnected] = useState(false)
  const [volume, setVolume] = useState<number[]>([80])
  const [voice, setVoice] = useState<string>("")
  const [sayLaptimes, setSayLaptimes] = useState(true)
  const [remindersEnabled, setRemindersEnabled] = useState(true)
  const [reminderFreqPractice, setReminderFreqPractice] = useState("5")
  const [reminderFreqRace, setReminderFreqRace] = useState("5")
  const [selectedDriver, setSelectedDriver] = useState<string>("")
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    const synth = window.speechSynthesis
    const updateVoices = () => {
      setAvailableVoices(synth.getVoices())
      if (!voice && synth.getVoices().length > 0) {
        setVoice(synth.getVoices()[0].voiceURI)
      }
    }
    updateVoices()
    synth.onvoiceschanged = updateVoices
    return () => {
      synth.onvoiceschanged = null
    }
  }, [voice])

  useEffect(() => {
    if (!connected || !selectedDriver) return

    const bc = new BroadcastChannel("rsma_radio")

    bc.onmessage = (event) => {
      const data = event.data
      if (data.type === "START_SEQUENCE") {
        playStartSequence(volume[0] / 100, data.playAt)
      } else if (data.type === "TTS_MESSAGE") {
        const { targets, text } = data
        if (targets.includes("ALL") || targets.includes(selectedDriver)) {
          const synth = window.speechSynthesis
          const utterance = new SpeechSynthesisUtterance(text)
          const selectedVoiceObj = availableVoices.find(v => v.voiceURI === voice)
          if (selectedVoiceObj) {
            utterance.voice = selectedVoiceObj
          }
          utterance.volume = volume[0] / 100
          synth.speak(utterance)
        }
      }
    }

    return () => {
      bc.close()
      window.speechSynthesis.cancel()
    }
  }, [connected, selectedDriver, voice, volume, availableVoices])

  // Automated TTS Logic
  useEffect(() => {
    if (!connected || !selectedDriver) return;

    let prevFlag = useRaceStore.getState().flagStatus;
    let prevLaps = useRaceStore.getState().drivers[selectedDriver]?.lapsCompleted || 0;
    let oneMinWarned = false;
    let oneLapWarned = false;
    let lastReminderTime = Date.now();

    const speak = (text: string) => {
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      const selectedVoiceObj = availableVoices.find(v => v.voiceURI === voice);
      if (selectedVoiceObj) u.voice = selectedVoiceObj;
      u.volume = volume[0] / 100;
      synth.speak(u);
    };

    const unsub = useRaceStore.subscribe((state) => {
      // 1. Flag Status
      if (state.flagStatus !== prevFlag) {
        speak(`${state.flagStatus} flag`);
        prevFlag = state.flagStatus;
      }

      const driver = state.drivers[selectedDriver];
      if (!driver) return;

      // 2. Laps Completed
      if (driver.lapsCompleted > prevLaps) {
        prevLaps = driver.lapsCompleted;
        if (sayLaptimes && driver.lastLapTime) {
          const secs = (driver.lastLapTime / 1000).toFixed(1);
          speak(`Lap time, ${secs} seconds`);
        }

        // 3. Race Laps Remaining Reminder
        if (state.sessionType === 'RACE' && state.sessionStartTime) {
          const lapsLeft = state.lapCount - driver.lapsCompleted;
          
          if (lapsLeft === 1 && !oneLapWarned) {
             speak("One lap remaining");
             oneLapWarned = true;
          } else if (remindersEnabled && lapsLeft > 0 && lapsLeft % parseInt(reminderFreqRace) === 0) {
             speak(`${lapsLeft} laps remaining`);
          }
        }
      }

      // 4. Time Remaining Warning (Practice/Quali)
      if (state.sessionType !== 'RACE' && state.sessionEndTime && state.sessionStartTime) {
         const timeLeftMs = state.sessionEndTime - Date.now();
         if (timeLeftMs <= 60000 && timeLeftMs > 0 && !oneMinWarned) {
            speak("One minute remaining");
            oneMinWarned = true;
         }
      }
    });

    // 5. Time Reminder Interval (Practice/Quali)
    const intervalId = setInterval(() => {
       const state = useRaceStore.getState();
       if (!remindersEnabled || state.sessionType === 'RACE' || !state.sessionEndTime || !state.sessionStartTime) return;

       const elapsedMins = (Date.now() - lastReminderTime) / 60000;
       const freqMins = parseInt(reminderFreqPractice);

       if (elapsedMins >= freqMins) {
           lastReminderTime = Date.now();
           const timeLeftMs = state.sessionEndTime - Date.now();
           if (timeLeftMs > 60000) {
               const minsLeft = Math.round(timeLeftMs / 60000);
               speak(`${minsLeft} minutes remaining`);
           }
       }
    }, 10000);

    return () => {
      unsub();
      clearInterval(intervalId);
    };
  }, [connected, selectedDriver, voice, volume, availableVoices, sayLaptimes, remindersEnabled, reminderFreqRace, reminderFreqPractice])

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative">
      
      {/* Top Navigation */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-center">
        <Button variant="ghost" onClick={() => navigate("/")} className="gap-2">
          <ChevronLeft className="w-4 h-4" /> Back
        </Button>
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-3xl">Driver Radio</CardTitle>
          <CardDescription>Connect to your team radio for live TTS updates</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!connected ? (
            <>
              <div className="space-y-2">
                <Label>Select Driver</Label>
                <Select value={selectedDriver} onValueChange={(val) => { if (val) setSelectedDriver(val) }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose your profile" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRESS">PRESS</SelectItem>
                    {driverList.map(d => (
                      <SelectItem key={d.username} value={d.username}>#{d.number} - {d.username}</SelectItem>
                    ))}
                    {driverList.length === 0 && (
                      <SelectItem value="demo" disabled>No active drivers</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>TTS Voice</Label>
                <Select value={voice} onValueChange={(val) => { if (val) setVoice(val) }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableVoices.length > 0 ? (
                      availableVoices.map(v => (
                        <SelectItem key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</SelectItem>
                      ))
                    ) : (
                      <SelectItem value="default" disabled>No voices available</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center py-6 space-y-8">
              {/* Visual Live indicator (no ping) */}
              <div className="relative flex items-center justify-center mt-4">
                <div className="relative inline-flex rounded-full h-24 w-24 bg-green-500 items-center justify-center text-white font-bold text-xl shadow-lg shadow-green-500/50">
                  LIVE
                </div>
              </div>
              
              <div className="w-full space-y-4 mt-8">
                
                {selectedDriver !== 'PRESS' && (
                  <div className="flex items-center justify-between">
                    <Label>Say Laptimes</Label>
                    <Switch checked={sayLaptimes} onCheckedChange={setSayLaptimes} />
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t">
                  <Label>Time/Laps Remaining Reminders</Label>
                  <Switch checked={remindersEnabled} onCheckedChange={setRemindersEnabled} />
                </div>

                {remindersEnabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Practice/Quali (mins)</Label>
                      <Select value={reminderFreqPractice} onValueChange={(val) => { if (val) setReminderFreqPractice(val) }}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Every 1 min</SelectItem>
                          <SelectItem value="5">Every 5 mins</SelectItem>
                          <SelectItem value="10">Every 10 mins</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Race (laps)</Label>
                      <Select value={reminderFreqRace} onValueChange={(val) => { if (val) setReminderFreqRace(val) }}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Every 1 lap</SelectItem>
                          <SelectItem value="2">Every 2 laps</SelectItem>
                          <SelectItem value="5">Every 5 laps</SelectItem>
                          <SelectItem value="10">Every 10 laps</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="space-y-4 pt-4 border-t">
                  <div className="flex justify-between">
                    <Label>Volume</Label>
                    <span className="text-sm text-muted-foreground">{volume[0] ?? 0}%</span>
                  </div>
                  <Slider 
                    value={volume} 
                    onValueChange={(val) => setVolume(Array.isArray(val) ? val : [val as number])} 
                    max={100} 
                    step={1} 
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter>
          {!connected ? (
            <Button 
              className="w-full text-lg h-14" 
              onClick={() => setConnected(true)}
              disabled={!selectedDriver}
            >
              Start Listening
            </Button>
          ) : (
            <Button 
              variant="destructive" 
              className="w-full text-lg h-14" 
              onClick={() => setConnected(false)}
            >
              Disconnect Radio
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
