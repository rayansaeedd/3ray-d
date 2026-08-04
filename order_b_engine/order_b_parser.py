"""Load an Order B workbook in the one-row-per-trip format into Trip objects.

Expected columns (see order_b_engine/README.md for the full spec and an example):
    Trip No.
    Makkah Dep / Makkah Arr
    Jeddah Dep / Jeddah Arr
    KAIA Dep / KAIA Arr
    KAEC Dep / KAEC Arr
    Madinah Dep / Madinah Arr

Each trip populates exactly one Dep cell (its origin) and one Arr cell (its destination),
plus Dep+Arr pairs for whichever intermediate stations it actually stops at. Everything
else is left blank. The parser cross-checks every row against trip_codes.decode_trip_number
and raises if the sheet disagrees with what the trip number itself implies.
"""
from __future__ import annotations

import datetime as dt

import openpyxl

from .models import Trip
from .trip_codes import decode_trip_number, TripNumberError

_STATIONS = ["Makkah", "Jeddah", "KAIA", "KAEC", "Madinah"]
_STATION_CODE = {"Makkah": "MAK", "Jeddah": "JED", "KAIA": "KAIA", "KAEC": "KAEC", "Madinah": "MAD"}


class OrderBFormatError(ValueError):
    pass


def _as_time(value) -> dt.time | None:
    if value is None or value == "":
        return None
    if isinstance(value, dt.time):
        return value
    if isinstance(value, dt.datetime):
        return value.time()
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        for fmt in ("%H:%M", "%H:%M:%S"):
            try:
                return dt.datetime.strptime(value, fmt).time()
            except ValueError:
                continue
        raise OrderBFormatError(f"unrecognized time value {value!r}")
    raise OrderBFormatError(f"unrecognized time cell type {type(value)!r}: {value!r}")


def load_order_b(path: str, sheet_name: str | None = None) -> list[Trip]:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet_name] if sheet_name else wb.active

    header = [c.value.strip() if isinstance(c.value, str) else c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    col_index = {name: i for i, name in enumerate(header) if name}

    required = ["Trip No."] + [f"{s} Dep" for s in _STATIONS] + [f"{s} Arr" for s in _STATIONS]
    missing = [c for c in required if c not in col_index]
    if missing:
        raise OrderBFormatError(f"Order B sheet is missing required columns: {missing}")

    trips: list[Trip] = []
    for row_num, row in enumerate(ws.iter_rows(min_row=2), start=2):
        values = [c.value for c in row]
        trip_no_raw = values[col_index["Trip No."]]
        if trip_no_raw is None or str(trip_no_raw).strip() == "":
            continue
        trip_no = str(trip_no_raw).strip().zfill(5)

        try:
            code = decode_trip_number(trip_no)
        except TripNumberError as e:
            raise OrderBFormatError(f"row {row_num}: {e}") from e

        station_times = {}
        for s in _STATIONS:
            arr = _as_time(values[col_index[f"{s} Arr"]])
            dep = _as_time(values[col_index[f"{s} Dep"]])
            if arr is not None or dep is not None:
                station_times[_STATION_CODE[s]] = (arr, dep)

        origin_code = code.origin
        dest_code = code.destination
        if origin_code not in station_times or station_times[origin_code][1] is None:
            raise OrderBFormatError(
                f"row {row_num} (trip {trip_no}): expected a departure time at origin "
                f"{origin_code}, per the trip number, but none was found"
            )
        if dest_code not in station_times or station_times[dest_code][0] is None:
            raise OrderBFormatError(
                f"row {row_num} (trip {trip_no}): expected an arrival time at destination "
                f"{dest_code}, per the trip number, but none was found"
            )

        dep_time = station_times[origin_code][1]
        arr_time = station_times[dest_code][0]

        stops = {
            station: times
            for station, times in station_times.items()
            if station not in (origin_code, dest_code)
        }

        trips.append(Trip(
            trip_no=trip_no,
            origin=origin_code,
            destination=dest_code,
            dep_time=dep_time,
            arr_time=arr_time,
            prefix=code.prefix,
            stops=stops,
        ))

    return trips
