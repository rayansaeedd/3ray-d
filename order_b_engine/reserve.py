"""Reserve duty assignment: drivers with no trip that day stand by at their home station.

Rules (as taught): no trip-pairing logic at all -- just a sign-in time and a flat 7-hour block.
Leftover drivers are spread across the operating day in shifts rather than all placed at once,
so there's standby coverage throughout the day.

The exact shift count/spacing wasn't pinned to a precise number ("maybe 3 to 4 reserve drivers
every 2 to 3 hours" was given as an example, not an exact spec), so it's exposed as configuration
here with those numbers as defaults -- flagged as an assumption to confirm, not a hard rule.
"""
from __future__ import annotations

import datetime as dt

from .models import Driver, Duty

RESERVE_DUTY_MIN = 7 * 60


def _add_minutes(t: dt.time, minutes: int) -> dt.time:
    total = t.hour * 60 + t.minute + minutes
    total %= 24 * 60
    return dt.time(hour=total // 60, minute=total % 60)


def build_reserve_duties(
    leftover_drivers: list[Driver],
    day_start: dt.time = dt.time(6, 0),
    day_end: dt.time = dt.time(22, 0),
    shift_interval_hours: int = 3,
    drivers_per_shift: int = 4,
) -> list[Duty]:
    """Spread leftover drivers across reserve shifts covering the operating day."""
    if not leftover_drivers:
        return []

    shift_starts = []
    minutes_cursor = day_start.hour * 60 + day_start.minute
    end_minutes = day_end.hour * 60 + day_end.minute
    while minutes_cursor < end_minutes:
        shift_starts.append(dt.time(hour=minutes_cursor // 60, minute=minutes_cursor % 60))
        minutes_cursor += shift_interval_hours * 60

    duties: list[Duty] = []
    for i, driver in enumerate(leftover_drivers):
        shift_start = shift_starts[(i // drivers_per_shift) % len(shift_starts)]
        sign_out = _add_minutes(shift_start, RESERVE_DUTY_MIN)
        task_code = f"{shift_start.strftime('%H%M')}/{RESERVE_DUTY_MIN // 60}"
        duties.append(Duty(
            driver=driver,
            task_code=task_code,
            sign_in=shift_start,
            sign_out=sign_out,
            legs=[],
            overtime=False,
            is_reserve=True,
        ))
    return duties
