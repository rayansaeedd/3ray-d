"""Joint scheduler: one pass across all three stations at once.

Why this exists (not just three calls to duty_builder.build_duties_for_station): each trip
family is shared between exactly two stations --

    00/01/03 (R1)      shared between MAK <-> MAD
    05 (shuttle)       shared between MAK <-> KAIA
    07/08 (R3)         shared between MAD <-> KAIA

-- and a given physical trip can be claimed as either side's leg (e.g. a Makkah-origin R1 trip
can be a Makkah-based driver's outbound leg, OR a Madinah-based driver's return leg). Running
each station independently (the old per-station builder) has no way to know the other station
already claimed the same trip. This module decides, once, who gets what.

Two rules matter here, in priority order:
  1. MANDATORY COVERAGE. Every trip must end up Main-driven by exactly one duty. Non-negotiable.
     Implemented as a true maximum bipartite matching (Kuhn's algorithm) over each shared
     family's compatibility graph, not a greedy first-pass -- a greedy version was tried first
     and left real, coverable trips unmatched simply because an earlier trip grabbed a return
     leg it didn't strictly need. Maximum matching guarantees the best coverage the schedule's
     timing actually allows; anything still uncovered after that is a genuine same-day
     impossibility (e.g. the literal last trip of the day in a family, which has nothing left
     running late enough to bring it back), not an algorithm gap.
  2. FAIRNESS. Each station's share of a shared family's duties should eventually track its
     share of the driver headcount, adjusted for how much headcount is already committed to
     that station's *other* shared family. NOT YET WIRED IN: real driver counts aren't
     available yet, and the "target-share cap inside the matching search" approach tried
     first was hard to verify correct (a capped node can still get matched via an augmenting
     path that reassigns someone else, which silently defeats the cap). target_duty_split()
     below computes the target split and is ready to use, but _solve_family() doesn't apply it
     yet -- today's matching is a plain, uncapped maximum matching, so the resulting station
     split is whatever the timing happens to produce, not fairness-weighted. Revisit once real
     rosters exist, ideally as a proper weighted/min-cost matching rather than another capped
     search.
"""
from __future__ import annotations

from dataclasses import dataclass

from .duty_builder import _try_build
from .models import Driver, Duty, Leg, Role, Trip
from .trip_codes import STATION_LETTER

# Each shared family: (prefixes, station_a, station_b). Order doesn't imply priority.
FAMILIES = [
    ({"00", "01", "03"}, "MAK", "MAD"),
    ({"05"}, "MAK", "KAIA"),
    ({"07", "08"}, "MAD", "KAIA"),
]


@dataclass
class JointResult:
    duties_by_station: dict           # {station: [Duty, ...]}
    uncovered: list                   # [Trip, ...] -- trips that got NO main driver from either side


def target_duty_split(total_pairs: int, station_a: str, station_b: str, driver_counts: dict) -> tuple[int, int]:
    """How many of `total_pairs` round-trip duties should go to station_a vs station_b.

    PLACEHOLDER: proportional to driver headcount only (defaults to even split when counts
    aren't provided). Doesn't yet account for each station's other shared-family obligations
    (e.g. Makkah's shuttle load should reduce its claim on R1) -- that needs real driver
    numbers, not yet available. Swap this function out once they are; nothing else in this
    module needs to change.
    """
    ca = max(driver_counts.get(station_a, 1), 0) or 1
    cb = max(driver_counts.get(station_b, 1), 0) or 1
    share_a = round(total_pairs * ca / (ca + cb))
    return share_a, total_pairs - share_a


def _make_duty(outbound: Trip, ret: Trip, cand, home_station: str) -> Duty:
    away_letter = STATION_LETTER.get(outbound.destination, "?")
    task_code = f"{cand.sign_in.strftime('%H%M')}/{cand.duty_min // 60}{away_letter}"
    # Driver identity is left blank (matches the web tool's "not yet assigned" convention) --
    # only home_station is real, since Duty.origin/destination derive from it.
    blank_driver = Driver(driver_id="", name="", phone="", home_station=home_station)
    return Duty(
        driver=blank_driver,
        task_code=task_code,
        sign_in=cand.sign_in,
        sign_out=cand.sign_out,
        legs=[Leg(outbound, Role.MAIN), Leg(ret, cand.leg2_role)],
        overtime=cand.overtime,
    )


def _same_day_dep_before_arr(dep, arr) -> bool:
    """Plain (non-wraparound) same-day check: does `dep` fall after `arr`? Deliberately NOT
    using models.minutes_between here, which adds 24h on a negative difference -- that's
    correct for a duty whose *own* last leg arrives just past midnight, but wrong for deciding
    whether two independent trips can chain: without this guard, _try_build will wrap all the
    way to "the next day" and call a trip departing at 06:00 a valid same-day return for one
    that doesn't arrive until 21:55, producing a ~14h phantom duty. Confirmed by hitting this
    exact failure against real data before adding the guard."""
    return (dep.hour, dep.minute) > (arr.hour, arr.minute)


def _best_main_main_edge(ta: Trip, tb: Trip):
    """Best (direction, candidate) for pairing ta and tb with BOTH legs driven as Main --
    the only case where a single duty provides full coverage for two trips at once. Tries
    both "which one departed first" possibilities; only one is usually chronologically valid."""
    options = []
    if _same_day_dep_before_arr(tb.dep_time, ta.arr_time):
        cand = _try_build(ta, Role.MAIN, tb, Role.MAIN)
        if cand:
            options.append(("a_out", cand))
    if _same_day_dep_before_arr(ta.dep_time, tb.arr_time):
        cand = _try_build(tb, Role.MAIN, ta, Role.MAIN)
        if cand:
            options.append(("b_out", cand))
    if not options:
        return None
    options.sort(key=lambda o: o[1].tier)
    return options[0]


def _build_main_main_adjacency(trips_a: list[Trip], trips_b: list[Trip]):
    """adj[trip_no] -> list of (other_trip, direction, candidate), best-fit first, Main+Main
    pairings only."""
    adj: dict[str, list] = {t.trip_no: [] for t in trips_a + trips_b}
    for ta in trips_a:
        for tb in trips_b:
            edge = _best_main_main_edge(ta, tb)
            if edge is None:
                continue
            direction, cand = edge
            adj[ta.trip_no].append((tb, direction, cand))
            adj[tb.trip_no].append((ta, direction, cand))
    for trip_no in adj:
        adj[trip_no].sort(key=lambda e: e[2].tier)
    return adj


def _kuhn_augment(node_no, adj, match, visited):
    """Standard Kuhn's-algorithm augmenting-path search: try every neighbor; if it's free,
    take it; if it's taken, try to find its current partner a different match first (freeing
    the neighbor up for us). Guarantees a maximum matching regardless of visit order."""
    for other, direction, cand in adj.get(node_no, []):
        if other.trip_no in visited:
            continue
        visited.add(other.trip_no)
        if other.trip_no not in match or _kuhn_augment(match[other.trip_no][0], adj, match, visited):
            match[node_no] = (other.trip_no, direction, cand)
            match[other.trip_no] = (node_no, direction, cand)
            return True
    return False


def _solve_family(
    trips_a: list[Trip], trips_b: list[Trip], station_a: str, station_b: str, target_a: int
) -> tuple[list[Duty], list[Duty], list[Trip]]:
    """target_a isn't used yet (see target_duty_split's docstring) -- kept as a parameter so
    the caller/tests don't need to change once fairness weighting is implemented for real.

    Two phases, not one matching pass -- a Main+Passenger "pairing" only provides coverage for
    the Main leg; the Passenger leg still needs its own separate Main driver from elsewhere, so
    it must NOT be treated as "consumed" the way a Main+Main pair is. An earlier version got
    this wrong (one bipartite matching, passenger edges included) and silently marked trips
    "covered" that had no actual main driver -- confirmed by tracing a specific real trip
    (00211) that the matching called covered via a passenger-role return, while structurally
    nothing in the schedule could ever be its main-driven return.

    Phase 1: maximum Main+Main matching -- the efficient case, one duty fully covers two trips.
    Phase 2: every trip Phase 1 didn't reach still needs its own duty (it's inherently that
    trip's own home station's outbound-Main -- a trip's origin is the only station that can
    ever Main it as an outbound leg), with a Passenger-only return chosen freely from any
    compatible trip (passenger seats aren't an exclusive resource, so this never competes with
    Phase 1's assignments or another Phase-2 trip's own return choice).
    """
    del target_a
    trips_a = sorted(trips_a, key=lambda t: (t.dep_time.hour, t.dep_time.minute))
    trips_b = sorted(trips_b, key=lambda t: (t.dep_time.hour, t.dep_time.minute))
    by_no = {t.trip_no: t for t in trips_a + trips_b}

    adj = _build_main_main_adjacency(trips_a, trips_b)
    match: dict[str, tuple] = {}
    for ta in trips_a:
        if ta.trip_no in match:
            continue
        _kuhn_augment(ta.trip_no, adj, match, {ta.trip_no})

    duties_a: list[Duty] = []
    duties_b: list[Duty] = []
    seen: set[str] = set()
    covered: set[str] = set()
    for trip_no, (other_no, _direction, cand) in match.items():
        pair_key = tuple(sorted((trip_no, other_no)))
        if pair_key in seen:
            continue
        seen.add(pair_key)
        # Whichever trip departs first is the outbound leg -- unambiguous regardless of which
        # node's adjacency list this edge was discovered from.
        t1, t2 = by_no[trip_no], by_no[other_no]
        outbound, ret = (t1, t2) if (t1.dep_time.hour, t1.dep_time.minute) <= (t2.dep_time.hour, t2.dep_time.minute) else (t2, t1)
        home_station = station_a if outbound.origin == station_a else station_b
        duty = _make_duty(outbound, ret, cand, home_station)
        (duties_a if home_station == station_a else duties_b).append(duty)
        covered.add(trip_no)
        covered.add(other_no)

    # Phase 2: mop up everyone Phase 1 didn't cover -- own outbound-Main, Passenger-only return.
    uncovered: list[Trip] = []
    for trip in trips_a + trips_b:
        if trip.trip_no in covered:
            continue
        home_station = station_a if trip.origin == station_a else station_b
        return_pool = trips_b if trip.origin == station_a else trips_a
        best = None
        for other in return_pool:
            if not _same_day_dep_before_arr(other.dep_time, trip.arr_time):
                continue
            cand = _try_build(trip, Role.MAIN, other, Role.PASSENGER)
            if cand and (best is None or cand.tier < best[1].tier):
                best = (other, cand)
        if best is None:
            uncovered.append(trip)
            continue
        other, cand = best
        duty = _make_duty(trip, other, cand, home_station)
        (duties_a if home_station == station_a else duties_b).append(duty)
        covered.add(trip.trip_no)

    return duties_a, duties_b, uncovered


def build_joint_schedule(trips: list[Trip], driver_counts: dict | None = None) -> JointResult:
    driver_counts = driver_counts or {}
    duties_by_station: dict[str, list[Duty]] = {"MAK": [], "MAD": [], "KAIA": []}
    all_uncovered: list[Trip] = []

    for prefixes, station_a, station_b in FAMILIES:
        family_trips = [t for t in trips if t.prefix in prefixes]
        trips_a = [t for t in family_trips if t.origin == station_a]
        trips_b = [t for t in family_trips if t.origin == station_b]

        total_pairs = round((len(trips_a) + len(trips_b)) / 2)
        target_a, _ = target_duty_split(total_pairs, station_a, station_b, driver_counts)

        duties_a, duties_b, uncovered = _solve_family(trips_a, trips_b, station_a, station_b, target_a)
        duties_by_station[station_a].extend(duties_a)
        duties_by_station[station_b].extend(duties_b)
        all_uncovered.extend(uncovered)

    # Always display top-to-bottom in the order the day actually runs: earliest sign-in first.
    # A station's duties come from up to two different shared families (e.g. MAK gets both
    # 00/01/03 and 05 duties), appended one family at a time above, so without this sort a
    # 6:00 duty from the second family could land below an 8:00 duty from the first.
    for station in duties_by_station:
        duties_by_station[station].sort(key=lambda d: (d.sign_in.hour, d.sign_in.minute))
    all_uncovered.sort(key=lambda t: (t.dep_time.hour, t.dep_time.minute))

    return JointResult(duties_by_station=duties_by_station, uncovered=all_uncovered)
