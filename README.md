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
  clearly shows ID, full name, and a phone line (the driver's real Phone 1 from the roster export,
  falling back to "No phone on file" only if that field is blank). **The Day Schedule is
  read-only**, with three exceptions: a disabled Origin indicator
  next to the date that just mirrors whatever's set in Task Settings, and a per-driver, per-day
  **Start**/**End** time pair the supervisor can edit directly to record or override that specific
  shift's start/end -- Start sits right after the driver's name, End sits at the far right after
  hour column 23. For a real trip they default to the duty's outbound start and return end, and
  once changed also update the matching visible time on the trip box itself; for a Reserve driver
  both start blank so a standby shift's start/end can be logged if needed. A read-only **Total**
  column after End shows that shift's length (e.g. "7h" or "7h 30m", wrapping correctly past
  midnight for night shifts) computed live from whatever Start/End currently say -- pure
  reference, nothing to edit there. Everything else lives in the **Task Settings** tab instead:
  each duty (Trip No., Category, Destination, per-leg trip numbers, per-leg Start/End)
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
  drivers, and an **Export to Excel** button next to it downloads that same day's schedule as a
  real `.xlsx` file (one row per driver: code, driver ID/name/phone, start/end/total, and a plain-
  English detail of the outbound/return trip or RESERVE/training/status). The **Full Roster** view
  has its own **Export to Excel** button in its toolbar that downloads the whole active month --
  driver identity columns, every day, every tally column -- as one `.xlsx`, colored exactly like
  the Full Roster screen (real off-duty code colors, purple training, blue RESERVE, red/amber
  conflict flags). Both exports run entirely in the browser via a small spreadsheet-writing
  library vendored directly into this file (no CDN, no network call -- see Known gaps below for
  more on that). A new **Training** tab defines courses (Code, Start/End date, Time From/To, Course
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
  (skipping any day they're already off) and clears anyone no longer on the list. Saving a
  training also runs a **6-on/2-off rest check**: every real driver is owed at least 2 days off
  after at most 6 working days in a row (trip, reserve, or training all count as working), scoped
  to just the stretch(es) the training actually touches -- if that stretch is too long or the gap
  to the next one is too short, the affected training day(s) turn amber (instead of the normal
  purple) and a popup tells the supervisor exactly which driver and which dates need a second
  look. The **Full Roster** view now mirrors the supervisor's real Excel roster directly: the
  same off-duty codes (F, V, O, 830/7T, T*, VA, A0, SW, S, E, EA, AJ, P*, R*, L, SD, FD, EF, XS*)
  use the same colors pulled straight from that workbook's own conditional formatting, each
  driver row has editable **Phone 1/2, Category, Email, ID, and Saudi** columns sourced from the
  real roster, and the right side has the same per-driver tally columns as the original sheet
  (per-code absence counts, manual Excess 1/2/3 + computed Total, manual Granted, computed
  No Tasks/Tasks, and Avg A0/V/S percentages) -- all editable or computed live, matching the
  original formulas. A **+ Month** control lets the supervisor add or switch to any calendar
  month with the identical fixed layout; only October 2026 has real day-by-day data today, so
  other months start with every driver row blank, ready to fill in by hand or generate against
  once populated. The **Roster Settings** tab has four panels reusing that same
  search-driver-and-Save mechanic from Training: **Vacation**, **Sick Leave**, and **Left
  Company** each write one fixed real off-duty code (V, S, O respectively, same color as the
  roster) across a date range -- Left Company only takes a start date and runs through the end
  of the current month, since someone who's left doesn't come back. **Holiday** is kept separate
  because a holiday day isn't paid the same as a normal working day (drivers actually working
  that day get extra pay, a driver on Holiday doesn't) and because a holiday can be one of
  several types -- a small **Holiday Types** catalog (seeded with EID, code `E`) lets the
  supervisor add more (e.g. Foundation Day) with their own code, then the Assign Holiday panel
  picks a type, a date range, and drivers the same way. All four reuse Training's own
  backfill-a-vacated-trip logic, but skip the 6-on/2-off rest check, since taking time off is
  the rest, not a violation of it.
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
- **Driver contact info** — done. Real Phone 1/2, Category, Email, ID, and Saudi-status fields
  were pulled from the supervisor's own Excel roster export and merged into `web/real_data.json`
  by matching driver name; all six are editable directly in the Full Roster, and the Day
  Schedule's driver column now shows the real Phone 1 number too (it only falls back to "No
  phone on file" if that field is blank for a given driver).
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
- **Persistence** — two layers now. (1) **Auto-save**: the whole live working state (task/training
  catalogs, holiday types, driver identity edits, every month's data, the generated schedule and
  its compliance numbers, all roster overrides, Conditions inputs, and whether the Conditions
  panel is open) is written to the browser's local storage every few seconds and on page close, and
  restored automatically the moment the page loads again -- refreshing or closing the tab no longer
  loses in-progress work. (2) **Saved Schedules**: a generated schedule can still be explicitly
  saved (named by its date range, e.g. "October 1 to October 7") via the **Save this schedule**
  button, and reloaded/deleted later from its red card in the Conditions sidebar, for keeping
  several named schedules (different weeks, a full month, etc.) side by side. Both are per-browser,
  per-device local storage, not a shared database -- neither shows up on a different computer or
  survives clearing browser data.
- **Conditions panel is collapsed by default** — the shift-window/stickiness/ratio/rest-rule
  settings, Generate button, and Saved Schedules list all live in the Conditions sidebar, which is
  now hidden by default so a returning supervisor lands straight on the Day Schedule/Full Roster
  instead of a settings panel (this also fixes it visually stacking below the schedule on
  narrow/mobile screens). Click **Show Conditions** in the tab bar to open it whenever generating a
  new schedule, adjusting a rule, or loading a saved schedule; that open/closed choice is
  remembered by the auto-save above, so it stays how you left it across reloads.
- **Schedule dates follow whichever month is selected on Full Roster** — the Start date/End date
  pickers in Task Settings are bounded to the currently active month (switch or add one with
  **+ Month** on the Full Roster tab). Only October 2026 has real day-by-day roster data today;
  any other month starts completely blank (every driver row empty) since there's no real data
  for it yet -- generating against a blank month is technically possible but produces a
  meaningless result until real off-duty codes are filled in for that month.
- **Two things from the original Excel roster were deliberately not replicated 1:1** when the
  real roster columns/tallies were ported in: (1) the sheet has two back-to-back "F" tally
  columns from what looks like a copy/paste accident -- only one is shown here, so the No Tasks
  total is computed without double-counting F. (2) The sheet's bottom summary block (Day Off,
  Eid Day, Vacations, Total Absence, Staff Per Day, Per Shift, Absence Per Day, etc., rows
  105-118) uses `COUNTIF` ranges that are inconsistently shifted row-by-row in the original file
  (e.g. mixing `H7:H99`, `H10:H105`, `H13:H110` for what should all be the same 99 driver rows),
  which produces visibly wrong numbers (negative "Staff Per Day", `#DIV/0!`) in the source itself.
  That block wasn't ported in as-is to avoid baking in those bugs -- say the word if you want it
  added with the ranges corrected instead.
- **Admin sign-in gate** — a full-screen password prompt now covers the tool until the right
  password is entered (a **Sign Out** button next to Show/Hide Conditions ends the session again).
  The password lives in one place in the code (`ADMIN_PASSWORD` near the top of the script) --
  change it there and only share the new one with whoever should have access. Being honest about
  what this does and doesn't do: it's a plain client-side check with no backend, so it stops
  casual/accidental access via the link, but it does **not** hide this page's contents -- including
  the embedded driver data -- from someone who deliberately views the page's source, since the
  whole file still ships to the browser regardless of the password. A real per-person login that
  actually protects the data would need a backend server (accounts, sessions, access logs), which
  is a much bigger build than this single HTML file -- worth doing later if that stronger guarantee
  becomes a requirement.
- **Excel export uses a vendored library** — `Export to Excel` on both the Day Schedule and Full
  Roster views is built with `xlsx-js-style` (SheetJS Community Edition plus real cell-color
  support), whose entire minified source is pasted directly into `web/admin_panel.html` (and
  `index.html`) right after the opening `<meta>` tag, between `<!-- BEGIN vendored xlsx-js-style
  -->` / `<!-- END -->` markers. It's inlined rather than loaded from a CDN so the export still
  works with no internet connection, exactly like everything else in this file. To update it later:
  `npm install xlsx-js-style` somewhere, then replace the text between those two markers with the
  new `dist/xlsx.min.js` contents (drop the trailing `//# sourceMappingURL=...` comment line, since
  the `.map` file isn't vendored).
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
