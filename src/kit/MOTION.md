# RSMA UI: which things animate and which do not

Principle: a 2000s desktop tool. Controls react instantly and mechanically; data never animates. Animation only exists to confirm "you pressed it" or "something just arrived". Nothing fades, glows, eases or slides.

## Animated (and why)
| Element | Animation | Why |
|---|---|---|
| `r-btn`, `r-btn--advance` | Press: bevel inverts, face darkens, label drops 1px, instantly. Release: 80ms, 2 steps. Latched with `is-on`. | The main action buttons (GO, STOP TIMER, flags, Advance, Ignore). The user must feel they were pressed. |
| `r-cell` | Press: sinks to black with inset edge, label drops 1px. Release 80ms stepped. | Steward actions (Notify, DSQ, radio channel). Same feel as buttons but flat. |
| `r-toggle` | Dome flips in 3 steps (120ms); ring presses while held. | Switching Auto flag / log displays on and off needs a visible mechanical flip. |
| `r-log__line.is-new` | One 450ms hard flash. | Draws the eye to a new incident, radio or log line without moving the list. |
| `r-lamp.is-blink` | 1Hz hard blink. | Alarm states only (for example a lost connection). Normal lamps never blink. |

## Not animated (and why)
| Element | Why |
|---|---|
| `r-header`, `r-panel`, `r-module`, `r-section`, `r-plate` | Static chrome. |
| `r-lcd` digits and clocks | Real LCDs update instantly; ticking digits must not animate. |
| `r-table` rows, selected row, position changes | Data should be exact the moment it changes; sliding rows would mislead stewards. |
| `r-lamp` on/off | Instant state, like a real lamp. |
| `r-field` | Focus ring appears instantly. |
| Text, scrolling log content | No transitions. |

Reduced motion: all transitions and keyframes are disabled under `prefers-reduced-motion: reduce`; the pressed look still shows, it just does not animate.
Timing tokens: `--r-t-press` (0ms), `--r-t-release` (80ms), `--r-t-flip` (120ms).
