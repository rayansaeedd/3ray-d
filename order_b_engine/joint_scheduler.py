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

from collections import defaultdict
from dataclasses import dataclass

from .duty_builder import (
    CAP_DUTY_MIN,
    MIN_MAIN_CONNECTION_MIN,
    SIGN_IN_BEFORE_MAIN_MIN,
    SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN,
    TARGET_DUTY_MIN,
    _add_minutes,
    _sub_minutes,
    _try_build,
)
from .models import Driver, Duty, Leg, Role, Trip, minutes_between
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


# ---------------------------------------------------------------------------------------------
# Shuttle (05, MAK<->KAIA) duties: NOT built via the general Main+Main bipartite matching below.
#
# Shuttle legs are short (~1h) and run every ~2h in each direction, so pairing "any valid same-
# day return" via Kuhn's algorithm can -- and did, in a real reported case -- leave a driver
# sitting idle for 5-6h at the far station between two legs that are each individually valid but
# far apart in time. The matching's tie-break never saw this: once a pairing's natural span fits
# under the 7:30 target, its duty_min gets flattened to exactly TARGET_DUTY_MIN regardless of how
# long the actual gap between legs was, so a 45-minute turnaround and a 5-hour wait looked
# identically good to the tier ranking.
#
# The real operational pattern (taught directly, not inferred from data):
#   Pattern 1 (chain): exactly 4 legs back-to-back, alternating direction, sign-in 30 min before
#     the first leg (not the usual 60) -- one duty covers 4 physical trips.
#   Pattern 2 (pair + Reserve): one round-trip pair, normal 60-min sign-in, padded out to the
#     7:30 target with Reserve time. Reserve goes after the pair by default -- which is exactly
#     what the general _try_build already does whenever a pairing finishes early, nothing new
#     needed there -- and only moves before the pair (sign-in pulled backward from the return
#     leg's arrival instead) when "after" would push sign-out past midnight.
SHUTTLE_SIGN_IN_BEFORE_CHAIN_MIN = 30
SHUTTLE_CHAIN_LEGS = 4


def _wraps_midnight(start, end) -> bool:
    """True if `end` is earlier in the clock than `start` -- i.e. adding minutes to reach it
    crossed midnight. Used only to decide Reserve placement below, not for the general same-day
    chaining guard (that's _same_day_dep_before_arr, a different check for a different question)."""
    return (end.hour, end.minute) < (start.hour, start.minute)


def _try_extend_shuttle_chain(current: Trip, pool_by_origin: dict, chain_trip_nos: set) -> Trip | None:
    """Earliest same-day, >=45min-gap trip departing from wherever the chain has just arrived,
    excluding only trips already in *this* chain (not a global claimed set -- see
    _enumerate_shuttle_chains for why chains are enumerated independently of each other)."""
    candidates = [
        t for t in pool_by_origin.get(current.destination, [])
        if t.trip_no not in chain_trip_nos
        and _same_day_dep_before_arr(t.dep_time, current.arr_time)
        and minutes_between(current.arr_time, t.dep_time) >= MIN_MAIN_CONNECTION_MIN
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda t: (t.dep_time.hour, t.dep_time.minute))


def _try_build_shuttle_chain(leg1: Trip, pool_by_origin: dict):
    """Pattern 1, structural validity only (no claimed-set check -- see
    _enumerate_shuttle_chains). Returns (chain, sign_in, sign_out, duty_min) or None."""
    chain = [leg1]
    chain_trip_nos = {leg1.trip_no}
    current = leg1
    for _ in range(SHUTTLE_CHAIN_LEGS - 1):
        nxt = _try_extend_shuttle_chain(current, pool_by_origin, chain_trip_nos)
        if nxt is None:
            return None
        chain.append(nxt)
        chain_trip_nos.add(nxt.trip_no)
        current = nxt

    sign_in = _sub_minutes(leg1.dep_time, SHUTTLE_SIGN_IN_BEFORE_CHAIN_MIN)
    last_arr = chain[-1].arr_time
    span = minutes_between(sign_in, last_arr)
    if span > CAP_DUTY_MIN:
        return None  # would need overtime -- never allowed, chain doesn't happen
    sign_out = _add_minutes(last_arr, SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN)
    duty_min = minutes_between(sign_in, sign_out)
    return chain, sign_in, sign_out, duty_min


def _enumerate_shuttle_chains(all_trips: list[Trip], pool_by_origin: dict):
    """Every structurally valid 4-leg chain, one attempt per possible starting trip, entirely
    independent of each other (no shared claimed-set while enumerating -- two chains here can
    legitimately both want the same trip; that conflict gets resolved by the greedy selection
    in _solve_shuttle_family, not here).

    Why enumerate-then-select instead of one greedy pass claiming trips as it goes: a single
    greedy forward pass (claim chains as soon as a valid one is found, earliest trip first)
    reliably produces clean, efficient chains for most of the day, but starves whichever trips
    sit at the far end of the day -- the last two departures in each direction can only ever be
    a chain's *last* leg, never a chain's start, so if the trips that could have fed into them
    already got claimed by an earlier chain that stopped one leg short, they're stranded with no
    same-day return at all under the 45-minute rule. Confirmed against the real 32-trip shuttle
    timetable: forward-greedy left 4 trips uncovered at the end of the day. Enumerating every
    possible chain first and then selecting greedily by *latest start time* (most-constrained
    trips claimed first, since they have the fewest valid chains available to them) recovers
    full coverage on that same data, at the cost of a longer link for the single pair of trips at
    the very start of the operating day that don't fit any chain -- an irregular early-morning
    timetable gap, not an algorithm gap."""
    chains = []
    for leg1 in all_trips:
        result = _try_build_shuttle_chain(leg1, pool_by_origin)
        if result is not None:
            chains.append(result)
    return chains


def _try_build_shuttle_pair_with_reserve(leg1: Trip, pool_by_origin: dict, claimed: set):
    """Pattern 2. Returns (leg1, leg2, sign_in, sign_out, duty_min, reserve_position) or None.
    reserve_position is "after" when the pad to reach TARGET_DUTY_MIN sits between leg 2's
    arrival and sign-out, "before" when it sits between sign-in and leg 1's departure, or None
    when the round trip is already >= TARGET_DUTY_MIN on its own with no padding needed."""
    candidates = [
        t for t in pool_by_origin.get(leg1.destination, [])
        if t.trip_no not in claimed
        and t.destination == leg1.origin
        and _same_day_dep_before_arr(t.dep_time, leg1.arr_time)
        and minutes_between(leg1.arr_time, t.dep_time) >= MIN_MAIN_CONNECTION_MIN
    ]
    if not candidates:
        return None
    leg2 = min(candidates, key=lambda t: (t.dep_time.hour, t.dep_time.minute))

    sign_in_fwd = _sub_minutes(leg1.dep_time, SIGN_IN_BEFORE_MAIN_MIN)
    span_fwd = minutes_between(sign_in_fwd, leg2.arr_time)
    if span_fwd <= CAP_DUTY_MIN:
        if span_fwd <= TARGET_DUTY_MIN:
            sign_out_fwd = _add_minutes(sign_in_fwd, TARGET_DUTY_MIN)
            reserve_position = "after"
        else:
            sign_out_fwd = _add_minutes(leg2.arr_time, SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN)
            reserve_position = None
        if not _wraps_midnight(sign_in_fwd, sign_out_fwd):
            return leg1, leg2, sign_in_fwd, sign_out_fwd, minutes_between(sign_in_fwd, sign_out_fwd), reserve_position

    # Reserve-before: anchor from the return leg's own arrival (no sign-out buffer -- this is
    # a computed backward target, not a "wrap up after arriving" pad) so the total is exactly
    # the 7:30 target and sign-out never needs to cross midnight.
    sign_out_bwd = leg2.arr_time
    sign_in_bwd = _sub_minutes(sign_out_bwd, TARGET_DUTY_MIN)
    return leg1, leg2, sign_in_bwd, sign_out_bwd, TARGET_DUTY_MIN, "before"


def _make_shuttle_duty(legs: list[Trip], sign_in, sign_out, duty_min, home_station: str,
                        reserve_position: str | None = None) -> Duty:
    away_letter = STATION_LETTER.get(legs[0].destination, "?")
    task_code = f"{sign_in.strftime('%H%M')}/{duty_min // 60}{away_letter}"
    blank_driver = Driver(driver_id="", name="", phone="", home_station=home_station)
    return Duty(
        driver=blank_driver,
        task_code=task_code,
        sign_in=sign_in,
        sign_out=sign_out,
        legs=[Leg(t, Role.MAIN) for t in legs],
        overtime=False,
        reserve_position=reserve_position,
    )


def _solve_shuttle_family(trips_a: list[Trip], trips_b: list[Trip], station_a: str, station_b: str):
    """Two passes. Returns (duties_a, duties_b, uncovered), same shape as _solve_family.

    Pass 1 (chains): enumerate every structurally valid 4-leg chain (see
    _enumerate_shuttle_chains), then greedily select a maximum non-overlapping set, latest
    start time first -- the most time-constrained trips (those nearest the end of the operating
    day, with the fewest chains available to them at all) get first claim, so they're not left
    stranded by an earlier, less-constrained chain that happened to be tried first.

    Pass 2 (pairs): whatever's left after Pass 1 becomes a round-trip pair + Reserve (see
    _try_build_shuttle_pair_with_reserve), or stays uncovered if even that has no valid return.
    """
    all_trips = sorted(trips_a + trips_b, key=lambda t: (t.dep_time.hour, t.dep_time.minute))
    pool_by_origin: dict[str, list[Trip]] = defaultdict(list)
    for t in all_trips:
        pool_by_origin[t.origin].append(t)

    claimed: set[str] = set()
    duties_a: list[Duty] = []
    duties_b: list[Duty] = []

    all_chains = _enumerate_shuttle_chains(all_trips, pool_by_origin)
    all_chains.sort(key=lambda c: (c[0][0].dep_time.hour, c[0][0].dep_time.minute), reverse=True)
    for legs, sign_in, sign_out, duty_min in all_chains:
        if any(t.trip_no in claimed for t in legs):
            continue
        claimed.update(t.trip_no for t in legs)
        duty = _make_shuttle_duty(legs, sign_in, sign_out, duty_min, legs[0].origin)
        (duties_a if legs[0].origin == station_a else duties_b).append(duty)

    for leg1 in all_trips:
        if leg1.trip_no in claimed:
            continue
        pair = _try_build_shuttle_pair_with_reserve(leg1, pool_by_origin, claimed)
        if pair is None:
            continue
        l1, l2, sign_in, sign_out, duty_min, reserve_position = pair
        claimed.add(l1.trip_no)
        claimed.add(l2.trip_no)
        duty = _make_shuttle_duty([l1, l2], sign_in, sign_out, duty_min, leg1.origin, reserve_position)
        (duties_a if leg1.origin == station_a else duties_b).append(duty)

    uncovered = [t for t in all_trips if t.trip_no not in claimed]
    return duties_a, duties_b, uncovered


# ---------------------------------------------------------------------------------------------
# Sweep ("monitoring") trains: one mandatory track-inspection run per row below, always departing
# before commercial operation starts. Taught directly (not inferred): trip numbers and transit
# durations are fixed, real-world constants verified against real duty-sheet photos -- these
# trips never appear in the dropped Order B file itself, they're synthesized here every time,
# same idea as a manual Add Task entry but automatic and always present regardless of file
# contents. Departure is always 1 hour before that station's single earliest commercial
# departure that day, across every family (not just the family the sweep itself feeds into --
# confirmed by KAIA's two sweeps, in opposite directions, departing at the exact same time in
# the reference photos, which only makes sense if both anchor to one shared "earliest from KAIA"
# time rather than each to its own direction).
SWEEP_ROUTES = [
    # (home_station, away_station, trip_no, duration_min, return_prefixes, return_role)
    ("MAD", "KAIA", "19065", 120, ("07", "08"), Role.PASSENGER),
    ("MAK", "KAIA", "12050", 60, ("05",), Role.MAIN),
    ("KAIA", "MAK", "14351", 100, ("05",), Role.PASSENGER),
    ("KAIA", "MAD", "14950", 150, ("07", "08"), Role.PASSENGER),
]


def _build_sweep_duties(trips: list[Trip]) -> tuple[dict[str, list[Duty]], set[str]]:
    """Returns (duties_by_station, claimed_trip_nos). The return leg -- the real commercial trip
    the sweep driver picks up to get back home -- is whichever same-family trip is earliest
    available after the sweep arrives (same 45-min connection rule and zero-overtime cap as every
    other pairing here; no Reserve padding, the duty is whatever length that natural gap makes
    it). Main for the MAK route (short hop, driver just keeps driving back); Passenger for the
    other three (driver rides back, someone else is that trip's actual Main -- a Passenger leg
    doesn't claim the trip, multiple people can ride the same train). If no same-day return fits
    at all, the duty still gets built with just the mandatory sweep leg -- it must always exist
    regardless, that's the whole point of it -- ending shortly after the sweep's own arrival."""
    duties_by_station: dict[str, list[Duty]] = {"MAK": [], "MAD": [], "KAIA": []}
    claimed: set[str] = set()

    for home_station, away_station, trip_no, duration_min, return_prefixes, return_role in SWEEP_ROUTES:
        home_trips = [t for t in trips if t.origin == home_station]
        if not home_trips:
            continue  # no commercial trips from this station in the dropped file -- nothing to anchor to
        anchor = min(t.dep_time for t in home_trips)
        sweep_dep = _sub_minutes(anchor, 60)
        sweep_arr = _add_minutes(sweep_dep, duration_min)
        sign_in = _sub_minutes(sweep_dep, SIGN_IN_BEFORE_MAIN_MIN)

        sweep_trip = Trip(trip_no=trip_no, origin=home_station, destination=away_station,
                           dep_time=sweep_dep, arr_time=sweep_arr, prefix="SWEEP")
        legs = [Leg(sweep_trip, Role.MAIN)]

        candidates = sorted(
            (t for t in trips
             if t.prefix in return_prefixes and t.origin == away_station and t.destination == home_station
             and _same_day_dep_before_arr(t.dep_time, sweep_arr)
             and minutes_between(sweep_arr, t.dep_time) >= MIN_MAIN_CONNECTION_MIN
             and minutes_between(sign_in, t.arr_time) <= CAP_DUTY_MIN),
            key=lambda t: (t.dep_time.hour, t.dep_time.minute),
        )

        if candidates:
            return_trip = candidates[0]
            legs.append(Leg(return_trip, return_role))
            sign_out = _add_minutes(return_trip.arr_time, SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN)
            if return_role == Role.MAIN:
                claimed.add(return_trip.trip_no)
        else:
            sign_out = _add_minutes(sweep_arr, SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN)

        duty_min = minutes_between(sign_in, sign_out)
        away_letter = STATION_LETTER.get(away_station, "?")
        task_code = f"{sign_in.strftime('%H%M')}/{duty_min // 60}{away_letter}"
        blank_driver = Driver(driver_id="", name="", phone="", home_station=home_station)
        duty = Duty(driver=blank_driver, task_code=task_code, sign_in=sign_in, sign_out=sign_out,
                    legs=legs, overtime=False)
        duties_by_station[home_station].append(duty)

    return duties_by_station, claimed


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

    # Sweep duties are built first and independently of the family loop below -- they're
    # synthesized, not drawn from `trips` at all, except for whichever real trip becomes a
    # sweep's Main-role return leg (only the MAK route does this), which has to be pulled out of
    # its family's pool so the normal solver doesn't also hand it to a different driver.
    sweep_duties, claimed_by_sweep = _build_sweep_duties(trips)
    for station, duties in sweep_duties.items():
        duties_by_station[station].extend(duties)

    for prefixes, station_a, station_b in FAMILIES:
        family_trips = [t for t in trips if t.prefix in prefixes and t.trip_no not in claimed_by_sweep]
        trips_a = [t for t in family_trips if t.origin == station_a]
        trips_b = [t for t in family_trips if t.origin == station_b]

        if prefixes == {"05"}:
            # Shuttle gets its own duty-shaping rules (4-leg chains / pair+Reserve) instead of
            # the general Main+Main matching -- see _solve_shuttle_family's docstring for why.
            duties_a, duties_b, uncovered = _solve_shuttle_family(trips_a, trips_b, station_a, station_b)
        else:
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
