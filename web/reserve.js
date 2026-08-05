/*
 * JavaScript port of order_b_engine/reserve.py -- deliberate line-for-line mirror. Leftover
 * drivers (no trip that day) are spread across fixed 7-hour reserve shifts covering the
 * operating day, cycling through shift-start times rather than placing everyone at once.
 *
 * The exact shift count/spacing wasn't pinned to a precise number ("maybe 3 to 4 reserve
 * drivers every 2 to 3 hours" was given as an example, not an exact spec), so it's exposed as
 * configuration here with those numbers as defaults, same as the Python version.
 *
 * Works both in the browser (window.ReserveBuilder) and under Node (module.exports).
 */
(function (root) {
  "use strict";

  const RESERVE_DUTY_MIN = 7 * 60;

  function addMinutesClock(totalMin, delta) {
    return ((totalMin + delta) % 1440 + 1440) % 1440;
  }

  function buildReserveDuties(
    leftoverDrivers,
    dayStartMin = 6 * 60,
    dayEndMin = 22 * 60,
    shiftIntervalHours = 3,
    driversPerShift = 4
  ) {
    if (!leftoverDrivers.length) return [];

    const shiftStarts = [];
    for (let m = dayStartMin; m < dayEndMin; m += shiftIntervalHours * 60) {
      shiftStarts.push(m);
    }

    return leftoverDrivers.map((driver, i) => {
      const shiftStart = shiftStarts[Math.floor(i / driversPerShift) % shiftStarts.length];
      const signOut = addMinutesClock(shiftStart, RESERVE_DUTY_MIN);
      const hh = String(Math.floor(shiftStart / 60)).padStart(2, "0");
      const mm = String(shiftStart % 60).padStart(2, "0");
      const taskCode = `${hh}${mm}/${RESERVE_DUTY_MIN / 60}R`;
      return {
        driver,
        taskCode,
        signIn: shiftStart,
        signOut,
        dutyMin: RESERVE_DUTY_MIN,
        overtime: false,
        isReserve: true,
        legs: [],
      };
    });
  }

  const ReserveBuilder = { buildReserveDuties, RESERVE_DUTY_MIN };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = ReserveBuilder;
  } else {
    root.ReserveBuilder = ReserveBuilder;
  }
})(typeof window !== "undefined" ? window : globalThis);
