# Impact tracking

The harness reports electricity (kWh), carbon (kg CO2e), and water (liters)
next to every dollar figure, tracks them across sessions in a gitignored
ledger, and renders a browser dashboard (`fpi-impact`).

## Layout

| Path                     | Purpose                                       | Git        |
| ------------------------ | --------------------------------------------- | ---------- |
| `impact/impact-core.mjs` | One engine for all impact math                | tracked    |
| `impact/config.json`     | User-editable assumptions                     | tracked    |
| `impact/defaults.json`   | Built-in defaults (revert target)             | tracked    |
| `impact/profiles.json`   | kWh per 1k tokens, per model class            | tracked    |
| `impact/states.json`     | eGRID 2022 state-level grid factors           | tracked    |
| `impact/ledger.jsonl`    | Durable raw-usage rows (never edited by hand) | gitignored |
| `impact/report.html`     | Browser dashboard (d3.js)                     | tracked    |
| `impact/server.mjs`      | Local server for the dashboard + config saves | tracked    |

## Assumptions (all editable)

1. **Electricity.** Tokens -> kWh uses Epoch AI inference-energy estimates via
   three model classes: efficient_small 0.01-0.08, balanced 0.05-0.5, frontier
   0.2-1.5 Wh per 1k tokens (`impact/profiles.json`, source:
   impact-equivalences, which cites Epoch AI).
2. **Carbon.** kg CO2e per kWh from EPA eGRID 2022. API providers default to
   the US average (0.386 kg/kWh) because the datacenter location is unknown -
   override per provider in `config.json:providerRegions`. Local models
   (ollama/local/\*) use `config.json:location` -> state factor (e.g. NC
   0.298 kg/kWh from `states.json`).
3. **Water.** Datacenter operational cooling water, 1.5 L/kWh typical (range
   0.7-3), based on industry WUE reports (Google reports ~1.1 L/kWh).
4. **Excluded** (matches impact-equivalences boundaries): model training,
   embodied hardware, networking, storage, user devices, and upstream
   electricity-generation water.
5. **Gaming comparisons** assume a high-end gaming PC at the wall:
   Cyberpunk 2077 ~400 W. Editable in `config.json:games`.

Edit any of these in `impact/config.json`, or live in the fpi-impact
"Assumptions" tab (saves back to the same file; "revert to defaults" restores
`defaults.json` values).

## How it works

- Raw usage rows (tokens + cost per call) come from pi session JSONL files and
  the pi-subagents sqlite. The `impact-cost` extension appends each session
  call to the gitignored ledger as it happens; `fpi-impact --sync` rescans
  session files to catch anything from before the extension existed.
- Impact values are **derived at display time** from the raw rows and the
  current config, so editing an assumption re-computes every report - past
  reports included. This is why the ledger stores tokens, not kWh.
- The ledger dedupes by fingerprint (session id + timestamp + token counts),
  so re-syncs never double-count.

## Commands

```bash
fpi-cost              # monthly $ report now includes kWh / kgCO2e / water
fpi-impact            # open the browser dashboard (data is synced first)
fpi-impact --stop     # stop the background dashboard server
```

## Dashboard

`fpi-impact` renders a d3.js dashboard on `127.0.0.1:8731`:

- **Totals** - stat cards and real-world comparisons for the selected period
  (all time, year, month, week, last day, or custom calendar range).
- **Trend** - one metric toggle (cost / carbon / electricity / water) drives
  the usage breakout flow, usage over time, and by-project / by-model bars.
- **Assumptions** - edit assumptions with live recompute; saves to
  `config.json`, "revert to defaults" restores `defaults.json` and keeps your
  location.

Full README with commands, layout, and assumptions: `../README.md`.
