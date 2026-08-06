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
  leg), the 45-minute minimum connection before any Main leg, and the 7:30 target / 8:00 hard cap
  duty length. Overtime is never allowed (station-wide policy) — a pairing that would need more
  than 8:00 is rejected as a candidate outright, not built and flagged; the trip may end up
  uncovered instead.
- **`reserve.py`** — spreads leftover drivers (no trip that day) across reserve shifts: fixed
  7:00 duty, no trip-pairing logic. Currently disabled in the web tool (see below).
- **`joint_scheduler.py`** — the *real* entry point for a full day's Order B: one pass across all
  three stations at once, not three independent per-station runs. See its own module docstring
  and the "Joint scheduling" section below — this is the piece that actually solves the
  cross-station coordination gap `duty_builder.py` always had.
- **`excel_export.py`** — writes the task schedule to Excel in the reference visual style
  (bordered trip-number box, route-color bar underneath, rotated dep/arr times, turnaround-station
  letter badge, RESERVE block). Not yet updated to consume `joint_scheduler.py`'s output directly
  (still wired to the older per-station `duty_builder.py` shape) — a real gap if you need a
  styled Excel export of a joint-scheduled day right now.
- **`demo.py`** — runs three scenarios and asserts correctness for `duty_builder.py` (the
  per-station builder); scenario 1 rebuilds Ziyad's real, already-verified duty (task `0630/8L`)
  from raw trip data with zero hardcoding of the answer.
- **`joint_demo.py`** — the equivalent correctness proof for `joint_scheduler.py`, against a real
  96-trip Order B WEEK page (`_test_data/all_trips_ground_truth.json`): asserts every trip ends
  up with *exactly one* Main driver, zero uncovered, zero double-booked.
- **`../web/order_b_scheduler.html`** — the supervisor-facing drag-and-drop tool, now backed by
  the joint scheduler (`web/joint_scheduler.js`, a validated port of `joint_scheduler.py`). Sign
  in as a station, drop the *full* Order B `.xlsx` (all stations, not pre-filtered) — it computes
  all three stations' duties in one pass and caches the result; switching stations just re-filters
  that cached result, no re-parse. See "Joint scheduling" below.

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
| Beyond cap | never — rejected as a candidate outright (zero-overtime policy), trip may go uncovered instead |
| Reserve duty length | fixed 7:00 |
| Reserve sign-in | a set shift-start time, spread across the day |

## Joint scheduling (`joint_scheduler.py`) — the real entry point for a full Order B day

`duty_builder.build_duties_for_station` looks at one station in isolation, which cannot work for
a real day: each trip family is shared between exactly two stations (00/01/03 ⇄ MAK/MAD, 05 ⇄
MAK/KAIA, 07/08 ⇄ MAD/KAIA), and a given physical trip can be Main-driven by either side (e.g. a
Makkah-origin R1 trip could be a Makkah-based driver's outbound, *or* a Madinah-based driver's
return leg). Running each station blind means two supervisors' independent runs can put two
different drivers in the Main seat on the same trip.

`build_joint_schedule(trips)` computes all three stations' duties in one pass instead, with two
rules in priority order:

1. **Mandatory coverage, non-negotiable.** Every trip ends up Main-driven by exactly one duty.
   Implemented as **two phases**, not one matching pass:
   - **Phase 1** — maximum bipartite matching (Kuhn's algorithm) over Main+Main pairings only:
     the efficient case, one duty fully covers two trips at once.
   - **Phase 2** — every trip Phase 1 didn't reach still gets its own duty (it's inherently that
     trip's own origin station's outbound-Main), with a Passenger-only return picked freely from
     any compatible trip.

   A **single-matching-pass version was built first and was wrong**: it let a Main+Passenger
   pairing "consume" both trips, when a Passenger leg provides no Main coverage at all — the
   Passenger-side trip still needs its own separate Main driver. This was caught by tracing one
   specific real trip (`00211`, a late-evening Madinah departure) that the first version called
   "covered" via a passenger-role return, when nothing in the schedule could actually be its
   Main-driven return. The two-phase version fixed it; `joint_demo.py` asserts every trip in a
   real 96-trip dataset gets *exactly* one Main driver as a standing regression check, specifically
   so this can't silently regress again.

   A second real bug surfaced during the same debugging: `_try_build`'s gap/duty-span math uses
   wraparound-safe minute arithmetic (needed for a duty whose *own* last leg legitimately arrives
   just after midnight), but without an explicit same-day guard it would also accept a trip
   departing at 06:00 as a "same-day" return for one that doesn't arrive until 21:55 — by
   silently wrapping all the way around to the next calendar day. `_same_day_dep_before_arr()`
   guards against this specifically; see its docstring for the exact real pairing that exposed it.

2. **Fairness — NOT YET WIRED IN.** Each station's share of a shared family should eventually
   track its share of driver headcount (adjusted for its other shared-family obligations — e.g.
   Makkah's shuttle load should reduce its claim on R1), per the supervisor's own explanation.
   Real driver counts aren't available yet. `target_duty_split()` computes a placeholder
   (headcount-only, even split by default) but the matching itself doesn't apply it — an earlier
   attempt to cap the matching search by a fairness target was hard to verify correct (a capped
   node can still get matched via an augmenting path that reassigns someone else, silently
   defeating the cap) and was dropped in favor of shipping a *provably correct* uncapped maximum
   matching now. Revisit once real rosters exist, ideally as a proper weighted/min-cost matching.

On the real 96-trip WEEK-pattern dataset: 48 duties, split 16/MAK, 16/MAD, 16/KAIA — purely from
the graph structure, with no fairness weighting applied yet.

**Not yet done:** `excel_export.py` and the driver-roster/reserve pieces still expect
`duty_builder.py`'s per-station shape; wiring `joint_scheduler.py`'s output through those is
unfinished. The web tool (`order_b_scheduler.html`) already uses the joint scheduler client-side.

## Known simplifications / open questions (flagged, not silently assumed)

1. ~~**Cross-station coordination.**~~ **Solved by `joint_scheduler.py`** — see the section below.
   `duty_builder.build_duties_for_station` (this module) still has the gap described below if
   used on its own; it's kept for the cases in `demo.py` and hasn't been deleted, but
   `joint_scheduler.py` is the one that should be used for anything spanning more than one
   station.
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

## The PDF converter (`web/order_b_pdf_converter.html`)

Solves the actual real-world gap: management sends Order B as a **PDF**, but the scheduler needs
the one-row-per-trip `.xlsx`. This tool converts it — fully client-side, no server:

- Drop the Order B PDF (any number of pages).
- Parses each page's text via a vendored copy of pdf.js (`web/vendor/pdf.min.js` — the classic,
  non-ES-module build, chosen specifically because ES modules are blocked by CORS under a plain
  `file://` page, so the newer pdfjs-dist releases don't work when the file is just double-clicked
  rather than served).
- **Generic extraction algorithm, not a hardcoded table layout** (`web/pdf_order_b_parser.js`):
  for each trip's column, the first schedule row with a value is its origin/departure, the last is
  its destination/arrival, everything between is an intermediate stop. This works from the
  document's own visual convention (journey flows top-to-bottom in the table) rather than assuming
  "this block is always Makkah-origin," so it holds up across WEEK/TH/FR/SA pages without
  per-page special-casing.
- **Multiple day-patterns are kept separate, not merged** — trip numbers repeat across WEEK/TH/FR/SA
  with (probably, not yet confirmed) different times, so the tool shows a page picker rather than
  silently overwriting one pattern's data with another's.
- Preview table + warnings **before** you download, so a parsing problem shows up as a wrong cell
  you can check against the PDF, not a silently wrong duty three steps later.

**Validated, not just built**: cross-checked against a hand-verified ground truth (the same trips
independently confirmed earlier in this project) — 0 mismatches across all 96 trips on the WEEK
page, and a full round-trip (PDF → browser converter → downloaded `.xlsx` → real
`order_b_parser.load_order_b()`) produces the identical 96 trips. Confirmed with real headless-browser
runs, not just Node unit tests.

**Still open**: the "SU-14 / MO-14" style date-range header on each schedule block likely encodes
which calendar dates each pattern actually applies to — not yet decoded, so picking the right
page for a given date is still manual.

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
