import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.formula import ArrayFormula
from openpyxl.formatting.rule import FormulaRule
import datetime
import shutil

SRC_TASKS = "/root/.claude/uploads/2cfc6bdb-220a-5258-a43c-090f63c66610/d8a61241-tasks.xlsx"
SRC_ROSTER = "/root/.claude/uploads/2cfc6bdb-220a-5258-a43c-090f63c66610/3b0cf3e2-schedule2.xlsx"
OUT = "/tmp/claude-0/-home-user-3ray-d/2cfc6bdb-220a-5258-a43c-090f63c66610/scratchpad/tasks_auto_assign.xlsx"

shutil.copy(SRC_TASKS, OUT)

# ---- 1. pull roster data (real driver rows only: 6-104) ----
rwb = openpyxl.load_workbook(SRC_ROSTER, data_only=True)
rws = rwb['OCT']

dates = [rws.cell(row=3, column=c).value for c in range(8, 39)]  # H..AL = Oct 1-31
drivers = []
for r in range(6, 105):
    name = rws.cell(row=r, column=7).value
    if not name:
        continue
    cat = rws.cell(row=r, column=3).value
    sid = rws.cell(row=r, column=5).value
    codes = [rws.cell(row=r, column=c).value for c in range(8, 39)]
    drivers.append((cat, sid, name, codes))

print(f"Imported {len(drivers)} drivers, {len(dates)} days")

# ---- 2. build Roster sheet in the tasks workbook ----
wb = openpyxl.load_workbook(OUT)  # keep formulas (data_only=False)

if "Roster" in wb.sheetnames:
    del wb["Roster"]
if "RosterRaw" in wb.sheetnames:
    del wb["RosterRaw"]
rs = wb.create_sheet("Roster")
raw = wb.create_sheet("RosterRaw")

ARIAL = "Arial"
header_font = Font(name=ARIAL, bold=True, size=10)
header_fill = PatternFill("solid", fgColor="D9E1F2")
note_font = Font(name=ARIAL, italic=True, size=9, color="808080")

rs["A1"] = "Category"
rs["B1"] = "Staff ID"
rs["C1"] = "Staff Name"
for i, d in enumerate(dates):
    col = 4 + i  # D onward
    c = rs.cell(row=1, column=col, value=d)
    c.number_format = "dd-mmm"
    c.font = header_font
    c.fill = header_fill
for col_letter in ("A", "B", "C"):
    rs[f"{col_letter}1"].font = header_font
    rs[f"{col_letter}1"].fill = header_fill

for i, (cat, sid, name, codes) in enumerate(drivers):
    r = 2 + i
    rs.cell(row=r, column=1, value=cat)
    rs.cell(row=r, column=2, value=sid)
    rs.cell(row=r, column=3, value=name)
    for j, code in enumerate(codes):
        rs.cell(row=r, column=4 + j, value=code)
    raw.cell(row=r, column=1, value=cat)
    raw.cell(row=r, column=2, value=sid)
    raw.cell(row=r, column=3, value=name)
    for j, code in enumerate(codes):
        raw.cell(row=r, column=4 + j, value=code)

raw["A1"] = "Category"
raw["B1"] = "Staff ID"
raw["C1"] = "Staff Name"
for i, d in enumerate(dates):
    c = raw.cell(row=1, column=4 + i, value=d)
    c.number_format = "dd-mmm"
raw.sheet_state = "hidden"

last_row = 1 + len(drivers)  # 100
for row in rs.iter_rows(min_row=1, max_row=last_row, min_col=1, max_col=3 + len(dates)):
    for cell in row:
        if cell.font.name != ARIAL or (cell.row > 1 and cell.font.bold):
            pass
        if cell.row > 1:
            cell.font = Font(name=ARIAL, size=10)

rs.column_dimensions["C"].width = 38
rs.column_dimensions["A"].width = 10
rs.column_dimensions["B"].width = 12
rs.freeze_panes = "D2"

note_row = last_row + 2
rs.cell(row=note_row, column=1,
        value=("Source: schedule2.xlsx 'OCT' tab, imported 2026-07-28. Rows 105-118 of the "
               "original (summary/statistics rows, not people) were excluded."))
rs.cell(row=note_row, column=1).font = note_font
rs.cell(row=note_row + 1, column=1,
        value=("To use a different month: paste that month's roster here as VALUES ONLY, same "
               "layout (Category | Staff ID | Staff Name | one date column per day), then update "
               "the DAY: date on each day tab to a date that exists in this table."))
rs.cell(row=note_row + 1, column=1).font = note_font

DATE_ROW_LAST = 1 + len(dates)  # =32 -> last date column is D..AH (col 4..34)
LAST_DATA_ROW = 1 + len(drivers)  # 100
print("Roster date col range D1:%s1, data rows 2:%d" % (get_column_letter(3 + len(dates)), LAST_DATA_ROW))

# ---- 3. wire up each day-sheet ----
OFF_CODES = ["F", "V", "O", "VR", "T*", "VA", "A0", "SW", "S", "E", "EA", "AJ", "P*", "R*", "L", "SD", "FD", "EF", "XS*"]

WEEKDAY_DATE = {
    "TEST ": datetime.datetime(2026, 10, 1),      # Thursday
    "TEST  (2)": datetime.datetime(2026, 10, 8),  # Thursday (was a duplicate Oct-1; moved to a distinct Thursday)
    "TEST  (3)": datetime.datetime(2026, 10, 2),  # Friday
    "TEST  (4)": datetime.datetime(2026, 10, 3),  # Saturday
    "TEST  (5)": datetime.datetime(2026, 10, 4),  # Sunday
    "TEST  (6)": datetime.datetime(2026, 10, 15), # Thursday (was a duplicate Oct-1; moved to a distinct Thursday)
    "TEST  (7)": datetime.datetime(2026, 10, 22), # Thursday (was a duplicate Oct-1; moved to a distinct Thursday)
}

POOL_LAST_ROW = 7 + len(drivers)  # header row7 + 99 drivers = row 106
TASK_FIRST_ROW = 8
TASK_LAST_ROW = 48

# NOTE: day-tab eligibility must read from the static RosterRaw snapshot, never from the
# visible Roster sheet -- Roster's blank cells are (later, in step 4) turned into formulas
# that read the day-tabs' own assignment results, and pointing eligibility at Roster instead
# of RosterRaw would create a circular reference (Roster cell -> day-tab NAME -> day-tab
# eligibility -> that same Roster cell).
roster_name_rng = f"RosterRaw!$C$2:$C${LAST_DATA_ROW}"
roster_code_rng = f"RosterRaw!$D$2:${get_column_letter(3+len(dates))}${LAST_DATA_ROW}"
roster_date_hdr = f"RosterRaw!$D$1:${get_column_letter(3+len(dates))}$1"

small_font = Font(name=ARIAL, size=9)
small_bold = Font(name=ARIAL, size=9, bold=True)

for sn in wb.sheetnames:
    if sn in ("Roster", "RosterRaw"):
        continue
    ws = wb[sn]

    # unmerge helper-column area if it clashes (AF120:AP121) - our pool ends row106, so should be clear,
    # but double check and unmerge defensively if any merge overlaps our write area.
    write_cols = {34, 36, 37, 38, 39}  # AH, AJ, AK, AL, AM  (skip AG=33, AI=35 which hold real data)
    for mc in list(ws.merged_cells.ranges):
        if mc.min_row <= POOL_LAST_ROW and mc.max_row >= 7:
            if any(c in write_cols for c in range(mc.min_col, mc.max_col + 1)):
                ws.unmerge_cells(str(mc))

    # headers for helper block (row 7, matching the main table's header row)
    ws["AH7"] = "Driver Pool"
    ws["AJ7"] = "Day Code"
    ws["AK7"] = "Rand Key"
    ws["AL7"] = "Rank"
    for coord in ("AH7", "AJ7", "AK7", "AL7"):
        ws[coord].font = small_bold

    # off-codes list (editable eligibility rule)
    ws["AM1"] = "OFF codes"
    ws["AM1"].font = small_bold
    ws["AN1"] = ("Edit this list to change which day-codes count as unavailable. "
                 "Blank cells in the roster are treated as available.")
    ws["AN1"].font = note_font
    for i, code in enumerate(OFF_CODES):
        ws.cell(row=2 + i, column=39, value=code).font = small_font  # col 39 = AM

    # Shuffle # -- a per-sheet seed. RAND() is volatile, so pressing F9 ANYWHERE reshuffles
    # every sheet at once; there is no way to scope F9 itself to one sheet. Instead, the
    # random key below is a deterministic hash of (this cell, row) using SIN/MOD, which are
    # NOT volatile -- so it only recalculates when THIS sheet's seed cell changes, leaving
    # every other day-tab untouched.
    ws["AN7"] = "Shuffle #:"
    ws["AN7"].font = small_bold
    seed_cell = ws["AO7"]
    seed_cell.value = None  # blank = no assignment generated yet
    seed_cell.font = small_bold
    seed_cell.fill = PatternFill("solid", fgColor="FFFF00")
    ws["AP7"] = "<- blank = no one assigned yet. Type a number (e.g. 1) to generate this day's assignment; change the number to reshuffle."
    ws["AP7"].font = note_font

    # Manual lock column: type a driver's exact name next to a task row (same row as the
    # task, in column AQ) to force that specific driver onto that task. Locked rows are
    # skipped by the random engine entirely (so reshuffling never touches them), AND that
    # driver is removed from the pool the random engine draws from for every OTHER row (so
    # they never get double-booked onto a second task the same day).
    ws["AQ7"] = "Manual Lock"
    ws["AQ7"].font = small_bold
    lock_fill = PatternFill("solid", fgColor="DDEBF7")
    for r in range(TASK_FIRST_ROW, TASK_LAST_ROW + 1):
        ws.cell(row=r, column=43).fill = lock_fill  # col 43 = AQ
    ws["AR7"] = "<- type a driver's exact name here to force them onto this row's task; leave blank for random"
    ws["AR7"].font = note_font

    date_cell = "$Z$5"

    for r in range(TASK_FIRST_ROW, POOL_LAST_ROW + 1):
        pool_idx = r - TASK_FIRST_ROW + 1  # 1-based position within Roster data rows
        ws.cell(row=r, column=34,
                value=f"=INDEX({roster_name_rng},{pool_idx})").font = small_font  # AH
        ws.cell(row=r, column=36,
                value=f"=IFERROR(INDEX({roster_code_rng},{pool_idx},MATCH({date_cell},{roster_date_hdr},0)),\"\")"
                ).font = small_font  # AJ
        ws.cell(row=r, column=37,
                value=(f'=IF(OR(COUNTIF($AM$2:$AM${1+len(OFF_CODES)},AJ{r})>0,'
                        f'COUNTIF($AQ${TASK_FIRST_ROW}:$AQ${TASK_LAST_ROW},AH{r})>0),1000+ROW(),'
                        f'MOD(SIN($AO$7*12.9898+ROW()*78.233)*43758.5453,1))')
                ).font = small_font  # AK
        ws.cell(row=r, column=38,
                value=f"=RANK(AK{r},$AK${TASK_FIRST_ROW}:$AK${POOL_LAST_ROW},1)").font = small_font  # AL

    for r in range(TASK_FIRST_ROW, TASK_LAST_ROW + 1):
        ws.cell(row=r, column=4,
                value=(f'=IF($AQ{r}<>"",$AQ{r},IF($AO$7="","",IFERROR(INDEX($AH${TASK_FIRST_ROW}:$AH${POOL_LAST_ROW},'
                        f'MATCH(ROW()-{TASK_FIRST_ROW-1},$AL${TASK_FIRST_ROW}:$AL${POOL_LAST_ROW},0)),'
                        f'"- add more drivers -")))'))

    # Row 49 was a leftover, unused second header ("Tasks"/"NAME" with a broken formula) --
    # repurpose it as a RESERVE line: everyone who's eligible that day but didn't land on one
    # of the 41 real tasks (more free drivers than tasks) gets listed here instead of just
    # vanishing. Locked drivers (Manual Lock column) are correctly excluded, since they already
    # have a task and are removed from the pool for other rows too.
    num_tasks = TASK_LAST_ROW - TASK_FIRST_ROW + 1
    ws["C49"] = "RESERVE"
    ws["C49"].font = small_bold
    reserve_formula = (
        f'=IF($AO$7="","",_xlfn.TEXTJOIN(", ",TRUE,'
        f'IF(($AK${TASK_FIRST_ROW}:$AK${POOL_LAST_ROW}<1)*($AL${TASK_FIRST_ROW}:$AL${POOL_LAST_ROW}>{num_tasks}),'
        f'$AH${TASK_FIRST_ROW}:$AH${POOL_LAST_ROW},"")))'
    )
    ws["D49"] = ArrayFormula("D49", reserve_formula)

    # tuck away the engine columns (candidate pool, day code, random key, rank, off-codes list) --
    # they still work, they just don't need to be looked at. Keep AN:AP (the Shuffle # control) visible.
    # NOTE: the original file has one merged column-width definition spanning columns 38-247 (AL
    # onward); openpyxl shares that single range object across every column in it, so hiding AL
    # silently hides AM/AN/AO/AP too unless we explicitly re-assert hidden=False on the ones that
    # must stay visible (forcing openpyxl to split them into their own entries on save).
    for col_letter in ("AH", "AJ", "AK", "AL", "AM"):
        ws.column_dimensions[col_letter].hidden = True
    for col_letter in ("AN", "AO", "AP"):
        ws.column_dimensions[col_letter].hidden = False

    # point the DAY: date at a real date that exists in the Roster (so eligibility filtering works)
    if sn in WEEKDAY_DATE:
        new_date = WEEKDAY_DATE[sn]
        for coord in ("Z5", "AE5"):
            fmt = ws[coord].number_format
            ws[coord] = new_date
            ws[coord].number_format = fmt if fmt and fmt != "General" else "dd-mmm-yyyy"

# ---- 4. reverse-fill Roster: blank day-cells get the task code the driver actually drew ----
# Only touch cells that are currently blank (no F/V/O/etc code); only for dates that have
# a matching day-tab (the ones in WEEKDAY_DATE). Every other cell / date is left untouched.
date_to_sheet = {}
for sn, dt in WEEKDAY_DATE.items():
    date_to_sheet[dt.date()] = sn

filled = 0
for i, d in enumerate(dates):
    col = 4 + i  # Roster column for this date (D onward)
    d_date = d.date() if hasattr(d, "date") else d
    sheet_name = date_to_sheet.get(d_date)
    if not sheet_name:
        continue
    col_letter = get_column_letter(col)
    for r in range(2, last_row + 1):
        cell = rs.cell(row=r, column=col)
        # "830/7T" is the generic on-duty placeholder used throughout the roster (not a
        # leave/off code) -- treat it the same as blank so these drivers also get upgraded
        # to either their real task code or RESERVE. Only genuine off-codes (F, V, O, etc)
        # are left completely alone.
        if cell.value not in (None, "", "830/7T"):
            continue  # keep existing F / V / O / etc as-is
        name_rng = f"'{sheet_name}'!$D${TASK_FIRST_ROW}:$D${TASK_LAST_ROW}"
        code_rng = f"'{sheet_name}'!$C${TASK_FIRST_ROW}:$C${TASK_LAST_ROW}"
        shuffle_cell = f"'{sheet_name}'!$AO$7"
        # blank until that day's Shuffle # is set; then either the task they drew, or
        # RESERVE if they were eligible that day but there were more free drivers than tasks
        cell.value = (
            f'=IF({shuffle_cell}="","",IFERROR(INDEX({code_rng},MATCH($C{r},{name_rng},0)),"RESERVE"))'
        )
        cell.font = Font(name=ARIAL, size=10, color="008000", bold=True)  # green = pulled from a day tab
        filled += 1

    # RESERVE should stand out from a real task code -- blue instead of green, same cells
    reserve_rule = FormulaRule(
        formula=[f'${col_letter}2="RESERVE"'],
        font=Font(name=ARIAL, size=10, color="0070C0", bold=True),
    )
    rs.conditional_formatting.add(f"{col_letter}2:{col_letter}{last_row}", reserve_rule)

print(f"Added {filled} reverse-lookup formulas to Roster (blank cells on dates with a matching day tab)")

rs.cell(row=note_row + 2, column=1,
        value=("GREEN BOLD task codes above are auto-filled formulas: if that driver drew a task "
               "on this date (via the matching day tab), the task code shows here automatically, "
               "and updates when that day tab's 'Shuffle #' changes. BLUE BOLD 'RESERVE' means that "
               "driver was free that day but there were more available drivers than tasks. Only "
               "dates with a matching day tab (currently Oct 1, 2, 3, 4, 8, 15, 22) do this; other "
               "dates, and any cell that already had a code (F, V, O, etc, shown in black), are untouched."))
rs.cell(row=note_row + 2, column=1).font = note_font

wb.save(OUT)
print("saved", OUT)
