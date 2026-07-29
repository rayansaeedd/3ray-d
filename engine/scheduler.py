"""
Core scheduling engine prototype: real Python code (not Excel formulas) that assigns
drivers to daily tasks across a full month, respecting:

  1. Shift-type stickiness: once a driver is on a shift type (Day/Afternoon/Night) for
     one work stretch, they must stay on that same type for the NEXT stretch too, before
     being allowed to switch (a "stretch" = one 6-on/2-off work cycle).
  2. Trip/Reserve ratio: soft target of 3 real trips + 3 reserve days per 6-day stretch,
     adjustable per driver when it can't be hit exactly (not enough tasks/drivers that day).

This is a prototype focused on getting the RULES right, run against your real roster
and task data, before we build the driver database, custom PDF/Excel layout, manual
task catalog, etc. on top of it.
"""
import datetime
import json
import random
from collections import defaultdict, Counter
from dataclasses import dataclass, field
from pathlib import Path

REAL_DATA_PATH = Path(__file__).resolve().parent.parent / "web" / "real_data.json"

OFF_CODES = {"F", "V", "O", "VR", "T*", "VA", "A0", "SW", "S", "E", "EA", "AJ",
             "P*", "R*", "L", "SD", "FD", "EF", "XS*"}

# ---- CONFIG: shift-type time windows (edit these to match your real rule) ----
SHIFT_WINDOWS = [
    ("Day", datetime.time(3, 30), datetime.time(10, 0)),
    ("Afternoon", datetime.time(10, 0), datetime.time(17, 0)),
    ("Night", datetime.time(17, 0), datetime.time(3, 30)),  # wraps past midnight
]

# ---- CONFIG: target trip/reserve ratio per 6-day stretch (soft, overridable per driver) ----
DEFAULT_TARGET_TRIPS_PER_STRETCH = 3
STRETCH_LENGTH_FOR_RATIO = 6  # the ratio is defined relative to a 6-day stretch

# per-driver overrides, e.g. {"6126072-ABDULAZIZ ADNAN M ABDULRAHIM": 5}
DRIVER_TARGET_OVERRIDES = {}

STRETCH_MIN_CONSECUTIVE = 2  # must stay on a shift type for this many stretches before switching


def classify_shift(start_time):
    for label, start, end in SHIFT_WINDOWS:
        if start <= end:
            if start <= start_time < end:
                return label
        else:  # wraps past midnight, e.g. 17:00 - 03:30
            if start_time >= start or start_time < end:
                return label
    return "Unknown"


@dataclass
class Task:
    code: str
    start_time: datetime.time
    shift_type: str


@dataclass(eq=False)  # identity-based hash/eq: each Stretch is a distinct object, never value-equal
class Stretch:
    driver: str
    day_indexes: list  # 0-based indexes into the month's day list
    shift_type: str = None
    target_trips: int = None
    assigned_trip_count: int = 0
    assignments: dict = field(default_factory=dict)  # day_index -> task code or "RESERVE"


def _load_real_data():
    with open(REAL_DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_tasks():
    data = _load_real_data()
    tasks = []
    for t in data["tasks"]:
        h, m = (int(x) for x in t["start"].split(":"))
        st = datetime.time(h, m)
        tasks.append(Task(code=t["code"], start_time=st, shift_type=classify_shift(st)))
    return tasks


def load_roster():
    data = _load_real_data()
    dates = [datetime.date.fromisoformat(d) for d in data["dates"]]
    drivers = {d["name"]: d["codes"] for d in data["drivers"]}
    return dates, drivers


def is_workday(code):
    return code not in OFF_CODES  # blank or "830/7T" (or anything else) counts as a working day


def detect_stretches(driver_name, codes):
    """Split a driver's month into maximal runs of consecutive working days."""
    stretches = []
    current = []
    for i, code in enumerate(codes):
        if is_workday(code):
            current.append(i)
        else:
            if current:
                stretches.append(Stretch(driver=driver_name, day_indexes=current))
                current = []
    if current:
        stretches.append(Stretch(driver=driver_name, day_indexes=current))
    return stretches


def assign_shift_types(stretches, tasks_by_shift):
    """Apply the 2-stretch stickiness rule per driver, choosing a shift type for each stretch.

    New shift-type picks are weighted by how many tasks that type actually needs to cover
    (not an even 1/3 each) -- otherwise a type with more real demand (e.g. Afternoon at ~46%
    of tasks) ends up structurally under-supplied by a uniform pick, causing genuine coverage
    shortages that have nothing to do with real driver availability.
    """
    labels = [w[0] for w in SHIFT_WINDOWS]
    weights = [max(1, len(tasks_by_shift.get(l, []))) for l in labels]

    def weighted_pick():
        return random.choices(labels, weights=weights, k=1)[0]

    by_driver = defaultdict(list)
    for s in stretches:
        by_driver[s.driver].append(s)
    for driver, drv_stretches in by_driver.items():
        drv_stretches.sort(key=lambda s: s.day_indexes[0])
        history = []  # list of (shift_type, run_length_on_that_type)
        for s in drv_stretches:
            if history and history[-1][1] < STRETCH_MIN_CONSECUTIVE:
                # must stay on the same type as last stretch
                chosen = history[-1][0]
                history[-1] = (chosen, history[-1][1] + 1)
            else:
                chosen = weighted_pick()
                history.append((chosen, 1))
            s.shift_type = chosen


def assign_ratios(stretches):
    for s in stretches:
        n = len(s.day_indexes)
        target = DRIVER_TARGET_OVERRIDES.get(s.driver, DEFAULT_TARGET_TRIPS_PER_STRETCH)
        # scale the target proportionally if this stretch isn't exactly 6 days
        scaled_target = round(target * n / STRETCH_LENGTH_FOR_RATIO)
        s.target_trips = max(0, min(n, scaled_target))


def run_month():
    tasks = load_tasks()
    tasks_by_shift = defaultdict(list)
    for t in tasks:
        tasks_by_shift[t.shift_type].append(t)

    dates, drivers = load_roster()
    all_stretches = []
    for name, codes in drivers.items():
        all_stretches.extend(detect_stretches(name, codes))

    assign_shift_types(all_stretches, tasks_by_shift)
    assign_ratios(all_stretches)

    # Day-by-day, TASK-COVERAGE-FIRST assignment: every one of the day's real tasks is a
    # train that has to run, so filling all of them outranks hitting the trip/reserve ratio
    # exactly. The ratio target is a *preference* (fill from under-target drivers first) but
    # a task never goes unfilled just because everyone eligible already hit their target --
    # it falls back to an eligible driver over their target instead. Only a genuine same-day
    # shortage of that shift type leaves a task unfilled (recorded in uncovered_tasks).
    for s in all_stretches:
        s.assignments = {}
        s.assigned_trip_count = 0
    uncovered_tasks = []  # (day_idx, task_code, shift_type) -- genuine shortages, for reporting

    num_days = len(dates)
    for day_idx in range(num_days):
        active_by_shift = defaultdict(list)
        for s in all_stretches:
            if day_idx not in s.day_indexes:
                continue
            s.assignments[day_idx] = "RESERVE"  # default; overwritten below if it gets a task
            active_by_shift[s.shift_type].append(s)

        tasks_today = list(tasks)
        random.shuffle(tasks_today)

        assigned_today = set()
        for t in tasks_today:
            pool = [s for s in active_by_shift.get(t.shift_type, []) if s not in assigned_today]
            if not pool:
                uncovered_tasks.append((day_idx, t.code, t.shift_type))
                continue
            under_target = [s for s in pool if s.assigned_trip_count < s.target_trips]
            candidates = under_target if under_target else pool
            chosen = random.choice(candidates)
            chosen.assignments[day_idx] = t.code
            chosen.assigned_trip_count += 1
            assigned_today.add(chosen)

    return dates, drivers, all_stretches, tasks_by_shift, uncovered_tasks


def compliance_report(dates, drivers, stretches, uncovered_tasks=()):
    total_stretches = len(stretches)
    ratio_exact = 0
    ratio_off_by = Counter()
    shift_switch_violations = 0
    by_driver = defaultdict(list)
    for s in stretches:
        by_driver[s.driver].append(s)
    for driver, drv_stretches in by_driver.items():
        drv_stretches.sort(key=lambda s: s.day_indexes[0])
        for i, s in enumerate(drv_stretches):
            actual_trips = sum(1 for v in s.assignments.values() if v != "RESERVE")
            diff = actual_trips - s.target_trips
            if diff == 0:
                ratio_exact += 1
            else:
                ratio_off_by[diff] += 1
            if i > 0:
                prev = drv_stretches[i - 1]
                # a violation = switched shift type after only 1 stretch (should wait for 2)
                if prev.shift_type != s.shift_type:
                    # find how many consecutive stretches prev's type had run for
                    run = 1
                    j = i - 1
                    while j > 0 and drv_stretches[j - 1].shift_type == prev.shift_type:
                        run += 1
                        j -= 1
                    if run < STRETCH_MIN_CONSECUTIVE:
                        shift_switch_violations += 1

    print(f"Total stretches: {total_stretches}")
    print(f"Stretches hitting exact trip target: {ratio_exact} ({100*ratio_exact/total_stretches:.1f}%)")
    print(f"Stretches off-target by N trips: {dict(ratio_off_by)}")
    print(f"Shift-type stickiness violations (switched too early): {shift_switch_violations}")
    print(f"Task-days genuinely short a driver (real shift-type shortage): {len(uncovered_tasks)}")


if __name__ == "__main__":
    random.seed(1)
    dates, drivers, stretches, tasks_by_shift, uncovered_tasks = run_month()
    print("Tasks per shift type:")
    for label, _, _ in SHIFT_WINDOWS:
        print(f"  {label}: {len(tasks_by_shift.get(label, []))} tasks")
    print()
    compliance_report(dates, drivers, stretches, uncovered_tasks)
