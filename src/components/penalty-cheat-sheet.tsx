import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { ShieldAlert } from "lucide-react"

const penalties = [
  {
    category: "1. Track Limits & Corner Cutting",
    items: [
      { text: "Minor corner cut with no advantage", points: "-1" },
      { text: "Corner cut gaining slight advantage", points: "-2" },
      { text: "Repeated corner cutting", points: "-3" },
      { text: "Excessive track extending after warning", points: "-3" },
      { text: "Leaving track and gaining position", points: "-3" },
      { text: "Failing to give back illegally gained position", points: "-4" },
      { text: "Track limits abuse throughout race", points: "-3" },
      { text: "Major shortcut/skipping part of track", points: "-5" },
    ]
  },
  {
    category: "2. Unsafe Rejoins",
    items: [
      { text: "Unsafe rejoin causing another driver to react", points: "-2" },
      { text: "Unsafe rejoin causing contact", points: "-4" },
      { text: "Unsafe rejoin causing major accident", points: "-6" },
      { text: "Unsafely reversing onto track", points: "-5" },
    ]
  },
  {
    category: "3. Avoidable Contact & Racing Incidents",
    items: [
      { text: "Heavy avoidable contact", points: "-3" },
      { text: "Pushing another car through a corner", points: "-2" },
      { text: "Causing another driver to spin", points: "-4" },
      { text: "Causing multi-car collision", points: "-5" },
      { text: "Deliberately forcing another driver off track", points: "-4" },
      { text: "Squeezing driver into wall", points: "-3" },
    ]
  },
  {
    category: "4. Defensive Driving Violations",
    items: [
      { text: "Illegal blocking (single incident)", points: "-2" },
      { text: "Excessive blocking", points: "-3" },
      { text: "Repeated weaving under braking", points: "-3" },
      { text: "Moving under braking", points: "-4" },
      { text: "Brake checking", points: "-5" },
    ]
  },
  {
    category: "5. Blue Flag Violations",
    items: [
      { text: "Ignoring blue flags", points: "-2" },
      { text: "Delaying faster car under blue flags", points: "-3" },
    ]
  },
  {
    category: "6. Pitlane Violations",
    items: [
      { text: "Dangerous pit entry", points: "-2" },
      { text: "Speeding in pit lane", points: "-2" },
      { text: "Crossing pit exit line illegally", points: "-2" },
      { text: "Unsafe pit release", points: "-3" },
    ]
  },
  {
    category: "7. Race Start Infractions",
    items: [
      { text: "Jump start", points: "-2" },
      { text: "False start (major)", points: "-3" },
    ]
  },
  {
    category: "8. Race Control & Steward Violations",
    items: [
      { text: "Ignoring race control instructions", points: "-3" },
      { text: "Lying during steward review", points: "-3" },
      { text: "Ignoring steward decision", points: "-5" },
    ]
  },
  {
    category: "9. Qualifying Infractions",
    items: [
      { text: "Failure to maintain minimum speed in qualifying", points: "-2" },
      { text: "Intentionally sandbagging qualifying for unfair advantage", points: "-3" },
      { text: "Blocking during qualifying", points: "-3" },
      { text: "Impeding another driver's qualifying lap", points: "-4" },
      { text: "Deliberately causing yellow flags in qualifying", points: "-5" },
    ]
  },
  {
    category: "10. Safety Car Violations",
    items: [
      { text: "Intentionally causing a Safety Car incident", points: "-8" },
      { text: "Overtaking Safety Car", points: "-6" },
      { text: "Overtaking another driver during a safety car/yellow flag", points: "-4" },
    ]
  },
  {
    category: "11. Unsportsmanlike Conduct",
    items: [
      { text: "Excessive headlight flashing to distract", points: "-1" },
      { text: "Unsportsmanlike conduct in voice/text chat", points: "-2" },
      { text: "Harassment or repeated toxicity", points: "-5" },
    ]
  },
  {
    category: "12. Exploits & Cheating",
    items: [
      { text: "Exploiting game bugs/glitches", points: "-6" },
      { text: "Exploiting physics or track exploits", points: "-6" },
      { text: "Excessive lag causing repeated incidents (avoidable)", points: "-2" },
      { text: "Intentionally exploiting lag", points: "-8" },
      { text: "Using cheats/mods/macros", points: "-16 + DQ + Ban" },
    ]
  },
  {
    category: "13. Intentional Dangerous Driving",
    items: [
      { text: "Deliberately stopping on racing line", points: "-6" },
      { text: "Deliberate retaliation after incident", points: "-6" },
      { text: "Stopping to interfere with leaders", points: "-8" },
      { text: "Intentional wrecking", points: "-10" },
      { text: "Driving backwards on track", points: "-10" },
      { text: "Deliberate race manipulation", points: "-10" },
    ]
  },
  {
    category: "14. Repeat Offenses",
    items: [
      { text: "Repeat offense within the same season", points: "+1 per repeat" }
    ]
  }
]

export function PenaltyCheatSheet() {
  return (
    <Sheet>
      <SheetTrigger render={
        <Button variant="outline" className="gap-2">
          <ShieldAlert className="w-4 h-4" />
          Penalty Ref
        </Button>
      } />
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto p-6">
        <SheetHeader className="px-0 pt-0">
          <SheetTitle>Penalty Cheat Sheet</SheetTitle>
          <SheetDescription>
            League Penalty System Draft & Steward Severity Guide
          </SheetDescription>
        </SheetHeader>
        
        <div className="my-6">
          <h3 className="font-semibold mb-2">Steward Severity Guide</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between border-b pb-1"><span>Minor</span> <span className="font-mono text-red-500 font-medium">-1</span></div>
            <div className="flex justify-between border-b pb-1"><span>Moderate</span> <span className="font-mono text-red-500 font-medium">-2</span></div>
            <div className="flex justify-between border-b pb-1"><span>Significant</span> <span className="font-mono text-red-500 font-medium">-3</span></div>
            <div className="flex justify-between border-b pb-1"><span>Major</span> <span className="font-mono text-red-500 font-medium">-4</span></div>
            <div className="flex justify-between border-b pb-1"><span>Severe</span> <span className="font-mono text-red-500 font-medium">-5</span></div>
            <div className="flex justify-between border-b pb-1"><span>Extreme</span> <span className="font-mono text-red-500 font-medium">-6</span></div>
            <div className="col-span-2 flex justify-between border-b pb-1 mt-2">
              <span>Intentional or cheating</span> 
              <span className="font-mono text-red-500 font-medium">-8 to -16 (Race Ban)</span>
            </div>
          </div>
        </div>

        <Accordion className="w-full">
          {penalties.map((cat, i) => (
            <AccordionItem value={`item-${i}`} key={i}>
              <AccordionTrigger className="text-left font-semibold text-sm hover:no-underline hover:text-primary">
                {cat.category}
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pt-2">
                  {cat.items.map((item, j) => (
                    <div key={j} className="flex justify-between items-start gap-4 text-sm">
                      <span className="text-muted-foreground">{item.text}</span>
                      <span className="font-mono text-red-500 font-medium whitespace-nowrap">{item.points}</span>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </SheetContent>
    </Sheet>
  )
}
