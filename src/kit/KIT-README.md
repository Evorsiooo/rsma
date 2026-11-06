# RSMA UI: a small component framework (iRaceControl-era look)

Build screens by assembling parts. No per-screen CSS: you only pick a part, a variant and a state, and drop it into a layout primitive.
Source of truth for the steward panel mockup (artifact https://claude.ai/artifact/5qZXBUe1oS8dhvFyFdNRMQ, version 24 uses exactly these classes).

## Files
| File | What |
|---|---|
| tokens.css | Every colour, font, size, gap and timing, as `--r-*` variables. Restyle here only. |
| base.css | Layout primitives: `r-stack`, `r-row`, `r-grid`, `r-fill`, `r-grow`, `r-fixed`, `r-pad`, `r-window` |
| components.css | The parts (below) |
| motion.css | All animation and pressed states. Remove this file for a static UI |
| rsma-ui.js | Optional helpers: toggle flipping, latching buttons, seven-segment `RSMA.lcd`, `RSMA.addLine` |
| catalog.html | Every part with live interaction |
| example-steward-screen.html | A whole screen built only from parts |
| PerfectDOSVGA437Win.ttf | The pixel font. Designed for 16px, never use other sizes |

## Naming rules
- Part: `r-part`. Slot (a required child): `r-part__slot`. Variant: `r-part--variant`. State: `is-state` (or an ARIA attribute where one exists).
- One value per role. Never write a literal colour or size in markup; use tokens. No inline font sizes.
- Every gap is `--r-gap` (4px). Header is 22px, buttons 30px (advance 42px).

## Layout primitives
- `r-stack` vertical, `r-row` horizontal (both gap 4px). `r-grid` with `style="--cols:3"` for equal columns of buttons.
- `r-fill` takes the remaining space (can shrink); `r-grow` grows but keeps content width; `r-fixed` keeps its own width.
- Give widths with inline `width:Npx` on the part only when a column must be fixed.

## Parts (API)
| Part | Slots / structure | Variants | States |
|---|---|---|---|
| `r-header` | text only. Raised grey title strip, one per panel/module | none | none |
| `r-panel` | `r-header` then body parts (`r-log`, `r-table`, `r-grid` of `r-cell`...) | none | none |
| `r-module` | `r-header` then `r-module__well` (clocks, lamps, toggles) | well: `--bare` | none |
| `r-lcd` / `r-blank` | black display. Fill with `RSMA.lcd(el,"00:37:52",{h,skew,ghost})` | `r-lcd--stack` (two rows) | none |
| `r-btn` | bevelled push button, label inside | `--advance` (tall, wrap label in `<span>`) | `:active`, `is-on`, `aria-pressed="true"`, `data-latch` |
| `r-cell` | flat dark action key | none | `:hover`, `:active`, `is-on`, `is-disabled` |
| `r-toggle` | `<button class="r-toggle" aria-pressed="true"><i></i></button>`; wrap with `r-toggle-group` and two `r-toggle__label` | `--grille` | `aria-pressed` true/false (flips on click via rsma-ui.js), `:active` |
| `r-lamp` | flat status lamp, 10px label | none | default on, `is-off`, `is-blink` |
| `r-plate` | big status word on black | none | none |
| `r-section` | `<div class="r-section"><span>Flags</span></div>` bracket caption | none | none |
| `r-field` | text input | none | `:focus-visible` |
| `r-log` | pixel-text list of `r-log__line` | `--title` (centred single line) | line colour: `is-yellow` `is-green` `is-red` `is-magenta`; new line: `is-new` |
| `r-table` | fixed layout; set `th` widths; text columns get `is-left`; numbers right-aligned | none | `tr.is-selected` |
| `r-text` | any other pixel text (status line, map labels) | `--dim` | none |

## Rules we settled on (do not break)
- All headers use `r-header`: same height, font, bevel, text offset, flush top-left.
- One pixel-font size (16px) for all table, log, field and status text; small Arial labels (section, toggle label, cell, lamp) are 10px.
- One shade per colour role (tokens). Red only where the meaning is red (penalty, stop, incident).
- No glow anywhere. Flat lamps.
- Tables: fixed layout, explicit column widths, numbers right-aligned.

## Motion (see MOTION.md for the full decision list)
Pixel feel: instant press, short stepped release (`steps()`), never smooth fades. Respects `prefers-reduced-motion`.
- `r-btn` / `r-btn--advance`: press inverts the bevel, darkens the face, drops the label 1px right and down, in 0ms; release springs back in 80ms over 2 steps. `is-on` / `aria-pressed="true"` holds it pressed (a latched button).
- `r-cell`: sinks to black with a 1px inset edge and the label drops 1px.
- `r-toggle`: the red dome flips in 3 steps (120ms) when `aria-pressed` changes; the ring presses in while held.
- `r-log__line.is-new`: flashes once (450ms, hard on/off), then settles.
- `r-lamp.is-blink`: 1Hz hard blink for alarms only.

## Using it
```html
<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="base.css">
<link rel="stylesheet" href="components.css"><link rel="stylesheet" href="motion.css">
<script src="rsma-ui.js"></script>
```
Artifacts (.dc.html) cannot link local CSS: paste the four CSS files into `<helmet><style>` and point the font-face at an uploaded asset (see the mockup).

## Note
iRaceControl is a third-party product. This kit recreates its general style as a reference; when RSMA's own look is decided, change `tokens.css` first, then the bevel/header recipes in `components.css`.
