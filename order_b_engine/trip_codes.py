"""Decode Haramain High Speed Rail trip numbers and map route families to stations.

A trip number is always 5 digits: [2-digit prefix][2-digit origin departure hour][1-digit direction].

Verified against real Order B examples (see order_b_engine/README.md for the worked cases):
    00060 -> MAK->MAD, 06:00 dep, 2 stops (Jeddah+KAEC)
    00061 -> MAD->MAK, 06:xx dep, 2 stops
    01070 -> MAK->MAD, 07:00 dep, 1 stop (Jeddah)
    01071 -> MAD->MAK, 07:30 dep, 1 stop (Jeddah)
    01120 -> MAK->MAD, 12:00 dep, 1 stop (Jeddah)
    03162 -> MAK->MAD, 16:20 dep, direct
    05200 -> MAK->KAIA, 20:35 dep, 1 stop (Jeddah)   [shuttle]
    07161 -> MAD->KAIA, 16:00 dep, 1 stop (KAEC)
    07230 -> KAIA->MAD, 23:00 dep, 1 stop (KAEC)
    08130 -> KAIA->MAD, 13:00 dep, direct
"""
from __future__ import annotations

from dataclasses import dataclass

MAK, MAD, KAIA, KAEC, JED = "MAK", "MAD", "KAIA", "KAEC", "JED"

# Route family per prefix: which two terminal stations the trip connects,
# and how many commercial stops it makes (and where).
_FAMILY_BY_PREFIX = {
    "00": {"endpoints": (MAK, MAD), "stops": 2, "even_origin": MAK},
    "01": {"endpoints": (MAK, MAD), "stops": 1, "even_origin": MAK},
    "03": {"endpoints": (MAK, MAD), "stops": 0, "even_origin": MAK},
    "05": {"endpoints": (MAK, KAIA), "stops": 1, "even_origin": MAK},
    "07": {"endpoints": (MAD, KAIA), "stops": 1, "even_origin": KAIA},
    "08": {"endpoints": (MAD, KAIA), "stops": 0, "even_origin": KAIA},
}

# The intermediate station(s) a family's trips pass through, in physical order
# between its two endpoints. Used only to know which stop columns matter.
_WAYPOINTS_BY_ENDPOINTS = {
    frozenset((MAK, MAD)): [JED, KAEC],
    frozenset((MAK, KAIA)): [JED],
    frozenset((MAD, KAIA)): [KAEC],
}

# Which home stations are allowed to run which prefixes (from the driver-group rules).
ALLOWED_PREFIXES = {
    MAD: {"00", "01", "03", "07", "08"},
    MAK: {"00", "01", "03", "05"},
    KAIA: {"05", "07", "08"},
}

HOME_STATIONS = (MAD, MAK, KAIA)


class TripNumberError(ValueError):
    pass


@dataclass(frozen=True)
class TripCode:
    trip_no: str
    prefix: str
    origin_hour: int
    direction_digit: int
    origin: str
    destination: str
    stops: int          # number of commercial stops (0, 1, or 2)
    waypoints: tuple     # intermediate stations this route family passes, in order origin->dest


def decode_trip_number(trip_no: str) -> TripCode:
    """Decode a 5-digit trip number into its route/origin/destination/stop-pattern."""
    trip_no = str(trip_no).strip()
    if len(trip_no) != 5 or not trip_no.isdigit():
        raise TripNumberError(f"trip number must be 5 digits, got {trip_no!r}")

    prefix = trip_no[0:2]
    if prefix not in _FAMILY_BY_PREFIX:
        raise TripNumberError(f"unknown route prefix {prefix!r} in trip {trip_no!r}")

    family = _FAMILY_BY_PREFIX[prefix]
    origin_hour = int(trip_no[2:4])
    direction_digit = int(trip_no[4])
    is_even = direction_digit % 2 == 0

    endpoints = family["endpoints"]
    even_origin = family["even_origin"]
    odd_origin = endpoints[0] if even_origin == endpoints[1] else endpoints[1]
    origin = even_origin if is_even else odd_origin
    destination = endpoints[0] if origin == endpoints[1] else endpoints[1]

    all_waypoints = _WAYPOINTS_BY_ENDPOINTS[frozenset(endpoints)]
    waypoints = tuple(all_waypoints if origin == even_origin else list(reversed(all_waypoints)))

    return TripCode(
        trip_no=trip_no,
        prefix=prefix,
        origin_hour=origin_hour,
        direction_digit=direction_digit,
        origin=origin,
        destination=destination,
        stops=family["stops"],
        waypoints=waypoints,
    )


def route_color(prefix: str) -> str:
    """Route-family color code, as defined by the supervisor (blue/green/red)."""
    if prefix in ("00", "01", "03"):
        return "blue"      # MAK <-> MAD
    if prefix == "05":
        return "red"       # shuttle MAK <-> KAIA
    if prefix in ("07", "08"):
        return "green"     # MAD <-> KAIA
    raise TripNumberError(f"unknown prefix {prefix!r}")


def home_stations_for_trip(trip_no: str) -> tuple:
    """Which home-station driver pools are even allowed to crew this trip."""
    code = decode_trip_number(trip_no)
    return tuple(hs for hs in HOME_STATIONS if code.prefix in ALLOWED_PREFIXES[hs])


# Single-letter station codes used on the task schedule (turnaround badges and the task
# code's trailing letter, e.g. "0630/8L" = a duty whose trip goes to Makkah).
STATION_LETTER = {MAK: "L", MAD: "M", KAIA: "A", KAEC: "K"}
