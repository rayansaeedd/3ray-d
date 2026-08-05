"""Rule engine: turns a station's trip pool into driver duties.

Rules encoded here (all confirmed against real examples in this conversation):
  - A duty is built from a driver's home station: leg 1 departs home, leg 2 returns home.
  - Sign-in = leg1.dep - 1h if leg1 is driven as Main, else -30min if leg1 is ridden as Passenger.
  - Before any leg where the driver is Main, the gap since the previous arrival must be >= 45 min.
    Before a Passenger leg there is no minimum gap.
  - Target duty length is 7:30; contractually allowed up to 8:00 with no penalty; beyond 8:00 is
    allowed only when nothing better fits, and gets flagged as overtime.
  - The final leg must arrive at/before sign-out.

Known simplification (flagged to the user, not silently assumed correct): this builder runs
per home station independently. It does not check whether some other station's run has already
put a different driver in the Main seat on the same physical return trip. In practice this
mirrors how supervisors work today (each covers their own station's outbound trips), but a
cross-station double-booking check is a real gap for a later version.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass

from .models import Driver, Duty, Leg, Role, Trip, minutes_between
from .trip_codes import ALLOWED_PREFIXES

SIGN_IN_BEFORE_MAIN_MIN = 60
SIGN_IN_BEFORE_PASSENGER_MIN = 30
MIN_MAIN_CONNECTION_MIN = 45
TARGET_DUTY_MIN = 7 * 60 + 30
CAP_DUTY_MIN = 8 * 60
# Not an explicitly-stated rule -- inferred from the one worked example we have (Ziyad:
# last arrival 14:20, recorded sign-out 14:30). Confirm this wrap-up buffer with the user
# before relying on it for real schedules.
SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN = 10
# Safety guard only (not a taught rule): reject a pairing whose total span is absurdly long,
# rather than silently building a nonsensical multi-day duty.
MAX_DUTY_SPAN_MIN = 14 * 60


def _add_minutes(t: dt.time, minutes: int) -> dt.time:
    total = t.hour * 60 + t.minute + minutes
    total %= 24 * 60
    return dt.time(hour=total // 60, minute=total % 60)


def _sub_minutes(t: dt.time, minutes: int) -> dt.time:
    return _add_minutes(t, -minutes)


@dataclass
class _Candidate:
    leg1_role: Role
    leg2_role: Role
    sign_in: dt.time
    sign_out: dt.time
    duty_min: int
    overtime: bool

    @property
    def tier(self) -> tuple:
        # lower is better: (role preference, cap-exceeded?, duty length)
        role_rank = 0 if self.leg2_role == Role.MAIN else 1
        return (role_rank, self.overtime, self.duty_min)


def _try_build(leg1: Trip, leg1_role: Role, leg2: Trip, leg2_role: Role) -> _Candidate | None:
    sign_in = _sub_minutes(
        leg1.dep_time,
        SIGN_IN_BEFORE_MAIN_MIN if leg1_role == Role.MAIN else SIGN_IN_BEFORE_PASSENGER_MIN,
    )

    if leg2_role == Role.MAIN:
        gap = minutes_between(leg1.arr_time, leg2.dep_time)
        if gap < MIN_MAIN_CONNECTION_MIN:
            return None

    span_to_arrival = minutes_between(sign_in, leg2.arr_time)
    if span_to_arrival > MAX_DUTY_SPAN_MIN:
        return None

    if span_to_arrival <= TARGET_DUTY_MIN:
        sign_out = _add_minutes(sign_in, TARGET_DUTY_MIN)
        duty_min = TARGET_DUTY_MIN
        overtime = False
    else:
        sign_out = _add_minutes(leg2.arr_time, SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN)
        duty_min = minutes_between(sign_in, sign_out)
        overtime = span_to_arrival > CAP_DUTY_MIN

    return _Candidate(leg1_role, leg2_role, sign_in, sign_out, duty_min, overtime)


def _best_pairing(leg1: Trip, leg2_candidates: list[Trip]) -> tuple[Trip, _Candidate] | None:
    best: tuple[Trip, _Candidate] | None = None
    for leg2 in leg2_candidates:
        if leg2.dep_time <= leg1.arr_time:
            # same-day forward connection only (no same-minute or backward-in-time legs)
            continue
        for leg2_role in (Role.MAIN, Role.PASSENGER):
            cand = _try_build(leg1, Role.MAIN, leg2, leg2_role)
            if cand is None:
                continue
            if best is None or cand.tier < best[1].tier:
                best = (leg2, cand)
    return best


def build_duties_for_station(
    trips: list[Trip],
    home_station: str,
    drivers: list[Driver],
) -> tuple[list[Duty], list[Trip]]:
    """Pair up a home station's departing trips into duties.

    Returns (duties, uncovered_departing_trips). Uncovered trips are ones that needed a Main
    driver (mandatory coverage) but had no feasible return leg within the rules — these need a
    human to look at them (extend the roster, relax constraints, or split across two drivers).
    """
    allowed = ALLOWED_PREFIXES[home_station]
    relevant = [t for t in trips if t.prefix in allowed]

    by_origin: dict[str, list[Trip]] = defaultdict(list)
    for t in relevant:
        by_origin[t.origin].append(t)

    departing = sorted(
        [t for t in relevant if t.origin == home_station],
        key=lambda t: (t.dep_time.hour, t.dep_time.minute),
    )

    used_as_return: set[str] = set()
    duties: list[Duty] = []
    uncovered: list[Trip] = []
    driver_cycle = list(drivers)
    driver_idx = 0

    for leg1 in departing:
        candidates = [
            t for t in by_origin.get(leg1.destination, [])
            if t.destination == home_station and t.trip_no not in used_as_return
        ]
        pairing = _best_pairing(leg1, candidates)
        if pairing is None:
            uncovered.append(leg1)
            continue

        leg2, cand = pairing
        used_as_return.add(leg2.trip_no)

        if not driver_cycle:
            uncovered.append(leg1)
            continue
        driver = driver_cycle[driver_idx % len(driver_cycle)]
        driver_idx += 1

        task_code = f"{cand.sign_in.strftime('%H%M')}/{cand.duty_min // 60}"
        duty = Duty(
            driver=driver,
            task_code=task_code,
            sign_in=cand.sign_in,
            sign_out=cand.sign_out,
            legs=[Leg(leg1, Role.MAIN), Leg(leg2, cand.leg2_role)],
            overtime=cand.overtime,
        )
        duties.append(duty)

    return duties, uncovered
