"""End-to-end demo / correctness check.

Primary proof: rebuild Ziyad's real duty (task 0630/8L: 01071 main out, 01120 main back,
sign-in 06:30, sign-out 14:30) purely from raw trip data + the rules -- no hardcoding of the
answer -- and confirm the engine reproduces it exactly.

Then a second run shows the "uncovered trip" path: a departing trip with no valid return in the
sample data, and a departing trip whose only same-day return would need overtime -- rejected
outright under the zero-overtime policy, so it's uncovered too rather than built with an
overtime flag. Real trip numbers/times already verified earlier in this project -- nothing
fabricated.
"""
from __future__ import annotations

import datetime as dt

from order_b_engine.duty_builder import build_duties_for_station
from order_b_engine.models import Driver, Role, Trip
from order_b_engine.reserve import build_reserve_duties
from order_b_engine.excel_export import write_task_schedule


def t(h, m):
    return dt.time(h, m)


# Real trips, all previously verified against the actual Order B / itinerary sheets in this project.
TRIP_01071 = Trip("01071", "MAD", "MAK", t(7, 30), t(9, 50), "01")
TRIP_01120 = Trip("01120", "MAK", "MAD", t(12, 0), t(14, 20), "01")
TRIP_00060 = Trip("00060", "MAK", "MAD", t(6, 0), t(8, 25), "00")
TRIP_05200 = Trip("05200", "MAK", "KAIA", t(20, 35), t(21, 29), "05")
TRIP_07161 = Trip("07161", "MAD", "KAIA", t(16, 0), t(17, 54), "07")
TRIP_07230 = Trip("07230", "KAIA", "MAD", t(23, 0), t(0, 54), "07")


def scenario_reproduce_ziyad():
    print("=== Scenario 1: reproduce Ziyad's real, already-verified duty ===")
    ziyad = Driver(driver_id="6868855", name="ZIYAD SALEH HAMZAH ALREHAILI", phone="562934948", home_station="MAD")
    trips = [TRIP_01071, TRIP_01120]
    duties, uncovered = build_duties_for_station(trips, "MAD", [ziyad])

    assert len(duties) == 1, f"expected 1 duty, got {len(duties)}"
    d = duties[0]
    checks = [
        (d.sign_in == t(6, 30), f"sign_in {d.sign_in} != 06:30"),
        (d.sign_out == t(14, 30), f"sign_out {d.sign_out} != 14:30"),
        (len(d.legs) == 2, "expected 2 legs"),
        (d.legs[0].trip.trip_no == "01071" and d.legs[0].role == Role.MAIN, "leg1 mismatch"),
        (d.legs[1].trip.trip_no == "01120" and d.legs[1].role == Role.MAIN, "leg2 mismatch"),
        (d.overtime is False, "should not be flagged overtime (exactly 8:00 cap, not beyond)"),
        (d.total_duty_minutes() == 8 * 60, f"duty length {d.total_duty_minutes()} != 480min"),
    ]
    for ok, msg in checks:
        assert ok, f"MISMATCH: {msg}"
    print(f"PASS: sign_in={d.sign_in} sign_out={d.sign_out} legs={[l.trip.trip_no for l in d.legs]} "
          f"roles={[l.role.value for l in d.legs]} duty={d.total_duty_minutes()}min overtime={d.overtime}")
    assert not uncovered
    return duties


def scenario_uncovered_and_overtime():
    print("\n=== Scenario 2: uncovered trips (real trip numbers, sparse sample) ===")
    driver_mak = Driver(driver_id="1000001", name="TEST DRIVER MAK", phone="500000001", home_station="MAK")
    duties_mak, uncovered_mak = build_duties_for_station([TRIP_00060, TRIP_05200], "MAK", [driver_mak])
    print(f"MAK station: {len(duties_mak)} duties built, {len(uncovered_mak)} uncovered "
          f"({[t.trip_no for t in uncovered_mak]}) -- expected: both uncovered, no return-leg data in this sample")
    assert len(duties_mak) == 0 and {t.trip_no for t in uncovered_mak} == {"00060", "05200"}

    # 07161's only same-day return (07230) would need a ~9:54 duty span. That used to build with
    # an overtime flag; under the zero-overtime policy it's rejected as a candidate outright, so
    # the trip is uncovered instead -- a human needs to look at it, not get a silent OT duty.
    driver_kaia = Driver(driver_id="1000002", name="TEST DRIVER KAIA", phone="500000002", home_station="MAD")
    duties_ot, uncovered_ot = build_duties_for_station([TRIP_07161, TRIP_07230], "MAD", [driver_kaia])
    print(f"MAD/KAIA pairing: {len(duties_ot)} duties built, {len(uncovered_ot)} uncovered "
          f"({[t.trip_no for t in uncovered_ot]}) -- expected: 07161 uncovered "
          f"(same-day return would need ~9:54, over the 8:00 cap -- zero-overtime policy rejects it)")
    assert len(duties_ot) == 0
    assert {t.trip_no for t in uncovered_ot} == {"07161"}
    return duties_mak + duties_ot


def scenario_reserve():
    print("\n=== Scenario 3: reserve shift spread ===")
    leftover = [Driver(f"200000{i}", f"RESERVE DRIVER {i}", f"5000000{i:02d}", "MAD") for i in range(10)]
    reserve_duties = build_reserve_duties(leftover, drivers_per_shift=4, shift_interval_hours=3)
    for rd in reserve_duties[:5]:
        print(f"  {rd.driver.name}: sign_in={rd.sign_in} sign_out={rd.sign_out} (7:00 fixed)")
    assert all(rd.total_duty_minutes() == 7 * 60 for rd in reserve_duties)
    return reserve_duties


if __name__ == "__main__":
    d1 = scenario_reproduce_ziyad()
    d2 = scenario_uncovered_and_overtime()
    d3 = scenario_reserve()

    out_path = "demo_task_schedule.xlsx"
    write_task_schedule(d1 + d2 + d3, out_path, title="Demo Output — Madinah / Makkah Station Driver Task Schedule")
    print(f"\nWrote {out_path}")
