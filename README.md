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
  targets a soft trip/reserve ratio per stretch. Task coverage is mandatory; the ratio target is
  a preference that yields when there aren't enough eligible drivers of the right shift type.
- **`engine/export_demo.py`** — runs the engine for a full month against the real roster and
  writes `Scheduling_Engine_Demo.xlsx`, including a compliance summary (exact-target rate,
  stickiness violations, genuine coverage shortages).
- **`web/admin_panel.html`** — a self-contained prototype admin panel. The same engine logic is
  ported to JavaScript and runs client-side against the embedded real data in
  `web/real_data.json`. The Day Schedule view is one row per active driver for the selected day
  (matching the original Gantt's per-duty layout): drivers with a real trip show two boxes
  (outbound leg + return leg) joined by a connector badge colored by destination, drivers on
  standby show a single RESERVE box. Every field (duty code, driver name, start, end) is
  directly editable. The **Task Settings** tab is the editable catalog behind it all: each of
  the 41 real duties (plus any new ones added there) has a Trip No., Category (Trip/Reserve),
  Destination, Start, and End — the Day Schedule is generated from this catalog, not a fixed list.
  A **Roster Settings** tab is scaffolded and awaiting its spec.
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
| Task coverage | Mandatory | Not configurable — a real train always needs a driver |

## Known gaps / not yet built

- **Driver HR database** (vacation/sick/delay/absence-report history) — the user confirmed this
  data exists in another system already; needs that source before designing the schema.
- **Manual task catalog** — done via the Task Settings tab: add/edit/remove duties (Trip No.,
  Category, Destination, Start, End), and the Day Schedule schedules against that live catalog.
  Driver rows in the Day Schedule are also directly editable (typing a code onto a RESERVE row
  assigns them a duty; typing RESERVE onto a duty row puts them back on standby).
- **Real trip pairing / connector codes** — done. Destinations are Makkah (L, blue), KAIA (A,
  green), KAEC (K, orange -- unconfirmed, ask to verify), and Sweep train (S, black, an
  early-morning monitoring run) per the user's legend. Each duty has independent outbound-leg
  and return-leg Start/End times (no longer a 50/50 split of one range) plus its own per-leg
  trip number, all editable directly inline on the Day Schedule row (the connector letter is a
  live dropdown between the two boxes; the four leg times are live time inputs before/after each
  box) or in bulk via Task Settings. The 41 existing duties still default to "Unassigned" (shown
  as "?") until classified.
- **Persistence** — manual edits to a driver row survive switching days/tabs, but are cleared by
  the next "Generate month" click or a page reload; nothing is saved to disk yet.
- **Email delivery** — sending generated schedules to drivers automatically (e.g. via a
  scheduled trigger + Gmail/Outlook) has been discussed but not implemented.

## Running the engine locally

```bash
cd engine
python3 export_demo.py   # writes Scheduling_Engine_Demo.xlsx in the current directory
```

Requires `openpyxl` (`pip install openpyxl`).

To try the admin panel, just open `web/admin_panel.html` directly in a browser — it's fully
self-contained, no build step or server required.
