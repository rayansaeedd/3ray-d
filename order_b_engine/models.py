"""Core data model for the driver task-scheduling engine."""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from enum import Enum


class Role(str, Enum):
    MAIN = "Main"
    PASSENGER = "Passenger"


@dataclass(frozen=True)
class Trip:
    """One scheduled train service, as read from an Order B row."""
    trip_no: str
    origin: str
    destination: str
    dep_time: dt.time
    arr_time: dt.time
    prefix: str
    stops: dict = field(default_factory=dict)  # {station: (arr_time, dep_time)} for intermediate stops


@dataclass
class Leg:
    trip: Trip
    role: Role


@dataclass
class Driver:
    driver_id: str
    name: str
    phone: str
    home_station: str


@dataclass
class Duty:
    driver: Driver
    task_code: str
    sign_in: dt.time
    sign_out: dt.time
    legs: list  # list[Leg]: 0 for reserve, 2 for a normal round trip, 4 for a chained shuttle duty
    overtime: bool
    is_reserve: bool = False

    @property
    def origin(self) -> str:
        return self.driver.home_station

    @property
    def destination(self) -> str:
        return self.driver.home_station

    def total_duty_minutes(self) -> int:
        return minutes_between(self.sign_in, self.sign_out)


def minutes_between(t1: dt.time, t2: dt.time) -> int:
    """Minutes from t1 to t2, assuming same day unless t2 has wrapped past midnight."""
    m1 = t1.hour * 60 + t1.minute
    m2 = t2.hour * 60 + t2.minute
    if m2 < m1:
        m2 += 24 * 60
    return m2 - m1
