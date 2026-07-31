# Driver Scheduling Engine

Rule-based crew scheduling for a high-speed rail driver roster. Replaces a spreadsheet-formula
system with real code: it detects each driver's work stretches, applies configurable shift and
ratio rules, and guarantees every real task gets covered before optimizing for anything softer.

> **Private repo — contains real driver data.** `web/real_data.json` includes real drivers' names
> and ID numbers pulled from an actual roster. Keep this repository private. If you fork or copy
> this project for another team, swap in synthetic data first.

## Layout

- **`engine/scheduler.py`** — the core engine. Detects each driver's 6-on/2-off work stretches
  from the roster, classifies tasks into shift types (Day/Afternoon/Night, configurable time
  windows) by start time, enforces a minimum-stretches-before-switching stickiness rule, and
  targets a soft trip/reserve ratio per stretch. Also enforces a minimum rest period (default 12h,
  configurable) between the end of one shift and the start of a driver's next one, tracked as an
  absolute end-of-shift timestamp per driver so it holds across day/reserve boundaries within a
  stretch. Task coverage is mandatory; the ratio target is a soft preference, but the rest rule is
  a hard constraint — a task goes uncovered rather than assign a driver who hasn't rested enough.
- **`engine/export_demo.py`** — runs the engine for a full month against the real roster and
  writes `Scheduling_Engine_Demo.xlsx`, including a compliance summary (exact-target rate,
  stickiness violations, genuine coverage shortages).
- **`web/admin_panel.html`** — a self-contained prototype admin panel. The same engine logic is
  ported to JavaScript and runs client-side against the embedded real data in
  `web/real_data.json`. The **Day Schedule** view is one row per active driver for the selected
  day (matching the original Gantt's per-duty layout): drivers with a real trip show two boxes
  (outbound leg + return leg), each with its own visible start/end time, joined by a connector
  badge colored by destination; drivers on standby show a single RESERVE box. The driver column
  clearly shows ID, full name, and a phone line (no phone data exists yet, so it reads "No phone
  on file"). **The Day Schedule is read-only** — it's a display of the generated result, nothing
  on it can be clicked or edited except a disabled Origin indicator next to the date, which just
  mirrors whatever's set in Task Settings. All editing lives in the **Task Settings** tab
  instead: each duty (Trip No., Category, Destination, per-leg trip numbers, per-leg Start/End)
  is editable there, plus one schedule-wide Origin station (Madinah/Makkah/KAIA, since it's this
  supervisor's own base). Rows can be reordered by long-pressing the drag handle. Task Settings
  also has real **Start date / End date** calendar pickers (native `<input type="date">`, so
  tapping one pops up the device's own calendar) that pick exactly which days to generate,
  capped to whatever `real_data.json` actually covers. Hitting **Generate schedule** builds just
  that range, and a **Save this schedule** button snapshots the generated result plus its Task
  Settings and Conditions into a small red card named after its date range (e.g. "October 1 to
  October 7") in the Conditions sidebar -- click a card to reload that saved schedule, or its
  &times; to delete it, so several schedules (different weeks, a full month, etc.) can be kept
  side by side. A **Print / Export** button on the Day Schedule view opens the browser's print
  dialog (which on most devices can also save straight to PDF) for handing a loaded schedule to
  drivers. A new **Training** tab defines courses (Code, Start/End date, Time From/To, Course
  Name, Capacity) the same way Task Settings defines duties; typing a training's code into a
  driver's day cell(s) on the **Full Roster** view (every cell there is now editable) sends that
  driver to the course instead of a shift -- the engine excludes them from task/reserve
  assignment on those days, on both a fresh generate and any roster edit made after the fact. If
  the driver already had a real trip that day, saving the edit tries to backfill it from another
  driver on Reserve that day in the same shift type who's rested enough (min-rest rule still
  applies); if nobody qualifies, that driver's cell turns red with the stranded trip's code so
  the supervisor can reassign it by hand. Every training code -- in its Full Roster cell or its
  Day Schedule block -- has a small &#9432; button that pops up the course's full details (dates,
  time window, name, capacity), since a hover tooltip never shows up on a touch device like an
  iPad. Each training also has an **Assigned Drivers** search box in the Training tab -- searching
  a driver by name and picking them (or removing their chip) only edits that training's own list;
  nothing touches the roster until its own **Save** button (next to Remove) is clicked, which
  writes the code into every listed driver's roster across the whole date range in one go
  (skipping any day they're already off) and clears anyone no longer on the list. A **Roster
  Settings** tab is scaffolded and awaiting its spec.
- **`engine/excel_formula_engine_build.py`** — an earlier, formula-only version of this same
  logic built directly into the original Excel workbook (Roster/RosterRaw tabs, a Shuffle #
  cell, a Manual Lock column, hidden helper columns). Kept for reference; superseded by the
  Python engine for anything beyond quick manual use in Excel.
- **`engine/graft_drawings.py`** — a fix for a real data-loss bug: openpyxl silently drops the
  original workbook's floating Gantt shapes (train numbers, RESERVE blocks, location tags) when
  rebuilding it. This script grafts them back onto the rebuilt file. Must run *after* the
  workbook is rebuilt and its formulas recalculated, never before.
- **`excel/office-scripts/`** — two Office Scripts for Excel Online's Automate tab:
  `setup_assignment_engine.osts` rebuilds the formula-only engine into a fresh copy of the
  workbook; `export_all_schedules.osts` exports every day tab as a clean, formula-free copy
  ready to send to drivers.

## Scheduling rules (current defaults)

| Rule | Default | Configurable? |
|---|---|---|
| Day shift window | 03:30–10:00 | Yes, per shift type |
| Afternoon shift window | 10:00–17:00 | Yes |
| Night shift window | 17:00–03:30 (wraps past midnight) | Yes |
| Minimum stretches before switching shift type | 2 | Yes |
| Target trips per 6-day stretch | 3 (3 trips + 3 reserve) | Yes, plus per-driver override |
| Minimum rest between shifts | 12 hours | Yes |
| Task coverage | Mandatory | Not configurable — a real train always needs a driver |

## Known gaps / not yet built

- **Driver HR database** (vacation/sick/delay/absence-report history) — the user confirmed this
  data exists in another system already; needs that source before designing the schema.
- **Driver phone numbers** — the Day Schedule now shows each driver's ID and full name clearly
  (no more truncation), plus a phone line, but `web/real_data.json` has no phone numbers at all
  — every row currently shows "No phone on file". Needs a real source; nothing was invented for
  this, since it's real people's contact information.
- **Manual task catalog** — done via the Task Settings tab: add/edit/remove/reorder duties
  (Trip No., Category, Destination, per-leg trip numbers, per-leg Start/End), plus one
  schedule-wide Origin station. The Day Schedule schedules against that live catalog. The Day
  Schedule itself is read-only by design — no editing happens there.
- **Real trip pairing / connector codes** — done. Destinations are Makkah (L, blue), KAIA (A,
  green), KAEC (K, orange -- unconfirmed, ask to verify), and Sweep train (S, black, an
  early-morning monitoring run) per the user's legend. Each duty has independent outbound-leg
  and return-leg Start/End times (no longer a 50/50 split of one range) plus its own per-leg
  trip number and origin station (Madinah/Makkah/KAIA), all editable in Task Settings. The 41
  existing duties still default to "Unassigned" (shown as "?") until classified.
- **Persistence** — a generated schedule can now be saved (named by its date range, e.g. "October
  1 to October 7") to the browser's local storage via the **Save this schedule** button, and
  reloaded/deleted later from its red card in the Conditions sidebar. This is per-browser,
  per-device storage, not a shared database -- it won't show up on a different computer or after
  clearing browser data. Unsaved Task Settings edits still only live in memory until saved this
  way.
- **Schedule dates are capped by real roster data** — the Start date/End date pickers in Task
  Settings only allow dates within October 2026 because `web/real_data.json` currently contains
  real roster data for that single month only. It cannot yet generate a genuinely *different*
  calendar month (e.g. September or December) since there's no real day-by-day roster for those
  months to schedule against -- that needs new roster data supplied for that month first.
- **Email delivery** — sending generated schedules to drivers automatically (e.g. via a
  scheduled trigger + Gmail/Outlook) has been discussed but not implemented.
- **Training capacity isn't enforced** — the Training catalog's Capacity field is informational
  only (how many seats a course has); the engine doesn't cap how many drivers can be sent to the
  same training code, since assignment is manual (typed into the roster) rather than automatic.

## Running the engine locally

```bash
cd engine
python3 export_demo.py   # writes Scheduling_Engine_Demo.xlsx in the current directory
```

Requires `openpyxl` (`pip install openpyxl`).

To try the admin panel, just open `web/admin_panel.html` directly in a browser — it's fully
self-contained, no build step or server required.
