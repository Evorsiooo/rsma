# RSMA UI: added parts (parts.css + parts.js)

Same look as the original kit: grey bevel header, bevelled `r-btn`, flat dark `r-cell`, black wells, pixel font at 16px, 10px Arial labels, 4px gaps, no glow. The original files are untouched. Load `parts.css` after `components.css`, and `parts.js` after `rsma-ui.js`:
```html
<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="components.css"><link rel="stylesheet" href="parts.css"><link rel="stylesheet" href="motion.css">
<script src="rsma-ui.js"></script><script src="parts.js"></script>
```
Catalog pages: `parts-radio.html`, `parts-app.html`, `parts-ops.html`.

## New parts
| Part | What | Notes |
|---|---|---|
| `r-btn--ptt` | Push-to-talk: a big `r-btn`. Hold pointer or Space/Enter. | `is-tx` (red label) while transmitting; event `rsma:ptt` `{on}`; `disabled` |
| `r-meter` / `r-progress` | LCD-segment bar in a black well. `style="--level:.6"` / `--value`. | green, yellow, red zones; `r-progress.is-wait` for unknown length |
| `r-readout` | Black value box for steppers and times | `is-red` `is-yellow` `is-green` |
| `r-stepper` | `r-cell` - `r-readout` `r-cell` + | |
| `r-banner` | Dark strip, coloured left edge. Notices, track state, errors, pending finish, toasts | `is-green` `is-red` `is-teal` |
| `r-dialog` | Bevelled window: `r-header`, `r-dialog__body`, `r-dialog__foot`. Sign-in, confirms, forms. Wrap in `r-backdrop` for a modal. | `--s` `--l`; `RSMA.modal(backdrop)` traps focus |
| `r-screen`, `r-boot` | Centred screen; loading screen (plate, `r-log` lines `is-ok/is-wait/is-fail`, `r-progress`, version) | |
| `r-topbar`, `r-statusbar`, `r-empty`, `r-popout` | App frame, empty state, driver pop-out width | |
| `r-label`, `r-form-field` | 10px Arial caps caption, hint and error text (same as `r-label`), required marker | `r-field.is-invalid` |
| `r-select`, `r-check`, `r-slider` | Same dark well and bevel as `r-field` | |
| `r-tag`, `r-count`, `r-avatar`, `r-user` | Role/status tags, unread count, user chip | tag colours `is-green/yellow/red/magenta/teal/white` |
| `r-timeline` | Pit window: striped window, green "now" marker | `--from --len --at` |
| `r-lamp--fixed` | the original lamp size, 25 x 20, for lamps in new panels (system status, RX/TX, live) | `r-lamp--red` `r-lamp--yellow` |
| `r-well`, `r-legend`, `r-toasts` | helpers | `RSMA.toast({text,tone})` |

## Built from existing parts (no new CSS)
- Channel list, recipients, quick messages, driver picker, tabs: `r-cell` / `r-btn` groups with `data-select="one|many"` (`is-on` marks the choice).
- RX/TX lamps: `r-lamp` and `r-lamp--red`. Transcript: `r-log r-log--wrap`.
- Queues, classification, roster, staff, audit: `r-table` / `r-log`.
- Sign-in key: `r-btn--advance`. 403/404/status: `r-plate` (`is-red` etc., `--xl`).
- Countdown and clocks: `r-lcd` via `RSMA.lcd`.

## Small additions to existing parts
`r-lamp--red`, `r-lamp--yellow`, `r-plate.is-green/yellow/red/magenta`, `r-plate--xl`, `r-log--wrap`, `r-log__line.is-dim`, `r-cell--red`, disabled `r-btn`/`r-cell`, `r-field` full width and invalid state.

## Checked
Each catalog page was rendered and reviewed. All headers measure 22px, no overflow, one pixel-font size (16px, 32px only for plates and push-to-talk).
