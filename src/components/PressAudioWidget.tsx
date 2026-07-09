import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Headphones } from "lucide-react"

export function PressAudioWidget() {
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voice, setVoice] = useState<string>("")
  const [volume, setVolume] = useState([80])
  const [listening, setListening] = useState(false)

  useEffect(() => {
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices()
      setAvailableVoices(v)
      if (v.length > 0 && !voice) setVoice(v[0].voiceURI)
    }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [voice])

  useEffect(() => {
    if (!listening) return

    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail
      const { targets, text } = data
      if (targets.includes('PRESS') || targets.includes('ALL')) {
          const v = availableVoices.find(x => x.voiceURI === voice)
          const u = new SpeechSynthesisUtterance(text)
          if (v) u.voice = v
          u.volume = volume[0] / 100
          window.speechSynthesis.speak(u)
      }
    }
    
    window.addEventListener('rsma_radio_message', handler)
    return () => {
      window.removeEventListener('rsma_radio_message', handler)
    }
  }, [listening, voice, volume, availableVoices])

  return (
    <div className="bg-card border rounded-md p-4 space-y-4 shadow-sm w-80 h-full flex flex-col justify-between">
      <div className="space-y-4">
        <div className="flex items-center gap-2 font-semibold">
        <Headphones className="w-4 h-4" />
        Race Control Live Feed
      </div>
      
      {!listening ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">TTS Voice</Label>
            <Select value={voice} onValueChange={(val) => { if (val) setVoice(val) }}>
              <SelectTrigger className="h-8 w-full [&>span]:truncate text-left">
                <SelectValue placeholder="Select Voice" />
              </SelectTrigger>
              <SelectContent>
                {availableVoices.map(v => (
                  <SelectItem key={v.voiceURI} value={v.voiceURI}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full h-8 text-xs" onClick={() => setListening(true)}>
            Connect Audio
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-500 font-bold text-xs uppercase animate-pulse">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            Connected
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <Label className="text-xs">Volume</Label>
              <span>{volume[0]}%</span>
            </div>
            <Slider 
              value={volume} 
              max={100} 
              step={1} 
              onValueChange={(val) => setVolume(typeof val === 'number' ? [val] : Array.from(val as number[]))} 
              className="py-2"
            />
          </div>
          <Button variant="outline" className="w-full h-8 text-xs" onClick={() => setListening(false)}>
            Disconnect
          </Button>
        </div>
      )}
      </div>
    </div>
  )
}
