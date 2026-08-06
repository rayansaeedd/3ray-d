"""End-to-end correctness check for joint_scheduler, against the same real 96-trip WEEK-pattern
dataset used to validate the PDF converter (order_b_engine/README.md has the extraction story).

Primary proof, in order of importance:
  1. Every one of the 96 real trips ends up with EXACTLY ONE Main driver -- not "matched" in
     some intermediate sense, the actual hard requirement. A Passenger leg does not count.
  2. Zero double-booking (no trip Main-driven by two different duties).
  3. Coverage this complete was NOT achievable with a greedy single-pass matcher -- see
     joint_scheduler.py's module docstring for the specific real trip (00211) that exposed why.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib

from order_b_engine.joint_scheduler import build_joint_schedule
from order_b_engine.models import Trip, minutes_between
from order_b_engine.trip_codes import decode_trip_number

GROUND_TRUTH_PATH = pathlib.Path(__file__).parent / "_test_data" / "all_trips_ground_truth.json"

_STATION_NAME_TO_CODE = {"Makkah": "MAK", "Jeddah": "JED", "KAIA": "KAIA", "KAEC": "KAEC", "Madinah": "MAD"}


def _parse_time(s: str) -> dt.time:
    h, m = map(int, s.split(":"))
    return dt.time(h, m)


def load_real_trips() -> list[Trip]:
    with open(GROUND_TRUTH_PATH) as f:
        raw = json.load(f)
    trips = []
    for trip_no, rec in raw.items():
        code = decode_trip_number(trip_no)
        dep_time = arr_time = None
        for key, value in rec.items():
            for station_name, station_code in _STATION_NAME_TO_CODE.items():
                if key == f"{station_name} Dep" and station_code == code.origin:
                    dep_time = _parse_time(value)
                if key == f"{station_name} Arr" and station_code == code.destination:
                    arr_time = _parse_time(value)
        trips.append(Trip(trip_no=trip_no, origin=code.origin, destination=code.destination,
                           dep_time=dep_time, arr_time=arr_time, prefix=code.prefix))
    return trips


def main():
    trips = load_real_trips()
    print(f"Loaded {len(trips)} real trips (all 6 prefixes, WEEK pattern)")

    result = build_joint_schedule(trips)
    counts_by_station = {k: len(v) for k, v in result.duties_by_station.items()}
    total_duties = sum(counts_by_station.values())
    print(f"Duties by station: {counts_by_station}")
    print(f"Total duties: {total_duties}")

    assert len(result.uncovered) == 0, f"expected 0 uncovered, got {[t.trip_no for t in result.uncovered]}"

    main_count: dict[str, int] = {}
    for duties in result.duties_by_station.values():
        for duty in duties:
            for leg in duty.legs:
                if leg.role.value == "Main":
                    main_count[leg.trip.trip_no] = main_count.get(leg.trip.trip_no, 0) + 1

    missing = [t.trip_no for t in trips if main_count.get(t.trip_no, 0) == 0]
    doubled = [trip_no for trip_no, count in main_count.items() if count > 1]
    assert not missing, f"trips with NO main driver: {missing}"
    assert not doubled, f"trips with 2+ main drivers (double-booked): {doubled}"

    print(f"PASS: all {len(trips)} trips have exactly one Main driver, zero uncovered, zero double-booked.")

    overtime_duties = [
        duty.task_code
        for duties in result.duties_by_station.values()
        for duty in duties
        if duty.overtime
    ]
    assert not overtime_duties, f"zero-overtime policy violated by: {overtime_duties}"
    print("PASS: zero overtime duties (station-wide policy).")

    # Shuttle-specific: the whole point of the shuttle rework was killing the 5-6h idle-gap
    # problem between two legs of the same duty. Generously capped at 3h (real worst case on
    # this data is ~2.5h, at the very start of the operating day) -- still catches a regression
    # back toward the original multi-hour-wait bug.
    shuttle_duties = [
        duty
        for duties in result.duties_by_station.values()
        for duty in duties
        if any(leg.trip.prefix == "05" for leg in duty.legs)
    ]
    assert shuttle_duties, "expected at least one shuttle duty in this dataset"
    max_shuttle_gap = max(
        minutes_between(duty.legs[i].trip.arr_time, duty.legs[i + 1].trip.dep_time)
        for duty in shuttle_duties
        for i in range(len(duty.legs) - 1)
    )
    assert max_shuttle_gap <= 180, f"shuttle duty has a {max_shuttle_gap}-min internal gap -- the 5-6h idle problem may have regressed"
    print(f"PASS: {len(shuttle_duties)} shuttle duties built, largest internal gap {max_shuttle_gap}min (well under the old 5-6h problem).")


if __name__ == "__main__":
    main()
