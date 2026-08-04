# Order B Driver Task Scheduling Engine

Builds driver task schedules directly from Order B, using the real domain rules (trip-number
decoding, origin-station filtering, main/passenger leg pairing, sign-in offsets, duty-length
targets, and Reserve duty) rather than generic shift heuristics. See `../engine/` for the
earlier, separate prototype that predates this rule set — kept untouched, not built on here.

## Layout

- **`trip_codes.py`** — decodes a 5-digit trip number into origin/destination/stop-pattern
  (`[prefix][origin hour][direction digit]`). Verified against 10 real trips pulled from actual
  Order B / itinerary sheets during development (see the module docstring).
- **`models.py`** — `Trip`, `Leg`, `Role` (Main/Passenger), `Driver`, `Duty`.
- **`order_b_parser.py`** — loads an Order B Excel workbook in the *one row per trip* format
  (see below) into `Trip` objects, cross-checking every row against what the trip number itself
  implies.
- **`duty_builder.py`** — the rule engine. For a home station, pairs departing trips with return
  trips into two-leg duties: sign-in (1h before a Main first leg, 30min before a Passenger first
  leg), the 45-minute minimum connection before any Main leg, the 7:30 target / 8:00 cap duty
  length, and the overtime flag beyond that.
- **`reserve.py`** — spreads leftover drivers (no trip that day) across reserve shifts: fixed
  7:00 duty, no trip-pairing logic.
- **`excel_export.py`** — writes the task schedule to Excel in the reference visual style
  (bordered trip-number box, route-color bar underneath, rotated dep/arr times, turnaround-station
  letter badge, RESERVE block).
- **`demo.py`** — runs three scenarios and asserts correctness; scenario 1 rebuilds Ziyad's real,
  already-verified duty (task `0630/8L`) from raw trip data with zero hardcoding of the answer.
- **`../web/order_b_scheduler.html`** — the supervisor-facing drag-and-drop tool. Sign in as a
  station, drop an Order B `.xlsx`, and it runs the same rules client-side to build that station's
  duties + reserve shifts, rendered in the box/bar/badge visual style. See `web/` section below.

## Order B input format

One row per trip (not the wide per-day grid the source PDFs use). Columns:

`Trip No.` · `Makkah Dep` · `Makkah Arr` · `Jeddah Dep` · `Jeddah Arr` · `KAIA Dep` · `KAIA Arr` ·
`KAEC Dep` · `KAEC Arr` · `Madinah Dep` · `Madinah Arr`

Each row populates exactly the Dep cell at its origin, the Arr cell at its destination, and
Dep+Arr pairs for whichever intermediate stations it actually stops at — everything else blank.
This is a direct re-flow of the same data already in the Order B "4.2 Schedule" grid, just one
trip per row instead of one trip per column.

## Scheduling rules encoded (confirmed against real examples during development)

| Rule | Value |
|---|---|
| Sign-in before a Main first leg | dep − 1h |
| Sign-in before a Passenger first leg | dep − 30min |
| Minimum connection gap before a Main leg | 45 min |
| Minimum connection gap before a Passenger leg | none (just must still finish before sign-out) |
| Target duty length | 7:30 |
| Contractual cap (no penalty) | 8:00 |
| Beyond cap | allowed, flagged overtime |
| Reserve duty length | fixed 7:00 |
| Reserve sign-in | a set shift-start time, spread across the day |

## Known simplifications / open questions (flagged, not silently assumed)

1. **Cross-station coordination.** `build_duties_for_station` runs per home station
   independently. It has no way to know whether a different station's run has already put a
   different driver in the Main seat on the same physical return trip. In the real workflow each
   supervisor covers their own station's outbound trips, which mostly avoids this — but nothing
   here actively checks for or prevents a double-booking across two supervisors' runs. Needs a
   real answer before this runs against a full multi-station Order B unattended.
2. **Competing demand for the same return leg.** If two different departing trips from the same
   station could both use the same return trip, the current algorithm resolves it by processing
   departing trips in departure-time order (earliest first claims the return leg). This is an
   assumption, not a taught rule — worth confirming the real tie-breaking policy.
3. **Sign-out buffer past the cap.** When a duty's required span exceeds the 7:30 target, sign-out
   is set to (last arrival + 10 minutes). That 10-minute figure is inferred from the one worked
   example available (Ziyad: arrival 14:20, recorded sign-out 14:30) — not a rule that was stated
   explicitly. Confirm before relying on it.
4. **Driver assignment order.** Drivers are cycled round-robin through each duty as it's built.
   No seniority, fairness, or preference rules are applied yet.
5. **Reserve shift spacing.** Defaults to 4 drivers per shift, every 3 hours, 06:00–22:00 — from
   "maybe 3 to 4 reserve drivers every 2 to 3 hours," given as an example, not an exact spec.
   Exposed as parameters on `build_reserve_duties` so it's easy to tune.
6. **Turnaround badge is a colored cell, not a circle.** An earlier prototype used a floating
   circle image; it didn't render in a mobile quick-look preview during testing, so this generator
   standardizes on the colored-cell + letter version, confirmed to render everywhere.

## Running it

```bash
python3 -m order_b_engine.demo   # runs the 3 scenarios, writes demo_task_schedule.xlsx
```

To run against a real Order B file:

```python
from order_b_engine.order_b_parser import load_order_b
from order_b_engine.duty_builder import build_duties_for_station
from order_b_engine.excel_export import write_task_schedule

trips = load_order_b("order_b_2026_08.xlsx")
duties, uncovered = build_duties_for_station(trips, "MAD", mad_drivers)
write_task_schedule(duties, "mad_task_schedule.xlsx")
```

Requires `openpyxl`.

## The drag-and-drop tool (`web/order_b_scheduler.html`)

Self-contained, no server or build step — just open the file in a browser:

1. **Sign in** as a station (Madinah / Makkah / KAIA) — unlocks the drop zone and scopes which
   trip prefixes get pulled from the file.
2. **Drop an Order B `.xlsx`** in the one-row-per-trip format (or click to browse). It's parsed
   client-side with a vendored copy of SheetJS (`web/vendor/xlsx.full.min.js` — vendored rather
   than loaded from a CDN, so the tool works offline and doesn't depend on a third-party host
   being reachable).
3. The engine logic runs in-browser (`web/order_b_engine.js`) and renders duties in the same
   box/bar/turnaround-badge visual style as the Excel export, plus a **reserve section** for
   leftover drivers and an **uncovered-trips warning** for any departing trip with no valid
   same-day return in the file.
4. **Download as Excel** exports a plain data table (not the styled version — SheetJS's free
   build can't write cell colors/borders, so the rich visual review lives on-screen; a fully
   styled export still requires running the Python `excel_export.py`).

`web/order_b_engine.js` is a deliberate line-for-line port of `duty_builder.py` /
`trip_codes.py` / `reserve.py`, not an independent reimplementation — `web/order_b_engine.test.js`
(`node web/order_b_engine.test.js`) mirrors `demo.py`'s scenarios and asserts the two produce
identical results, so the browser tool can't silently drift from the Python engine's behavior.

**Driver roster is currently a placeholder** (`PLACEHOLDER_ROSTER` inside the HTML file, a
handful of fake names per station plus Ziyad and Rayan for continuity with earlier examples) —
it needs to be swapped for each station's real roster (ID / Name / Phone) before this is used
for anything beyond demoing the drag-and-drop flow.
