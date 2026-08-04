/*
 * JavaScript port of order_b_engine (the Python package at repo root). Kept as a faithful,
 * line-for-line mirror of duty_builder.py / trip_codes.py / reserve.py so the browser-side
 * drag-and-drop tool produces the same duties as the Python engine. Cross-checked against the
 * same Ziyad scenario used in order_b_engine/demo.py -- see order_b_engine.test.js.
 *
 * Works both in the browser (attaches to window.OrderBEngine) and under Node (module.exports),
 * so the same file can be unit-tested with `node web/order_b_engine.test.js`.
 */
(function (root) {
  "use strict";

  const MAK = "MAK", MAD = "MAD", KAIA = "KAIA", KAEC = "KAEC", JED = "JED";

  const FAMILY_BY_PREFIX = {
    "00": { endpoints: [MAK, MAD], stops: 2, evenOrigin: MAK },
    "01": { endpoints: [MAK, MAD], stops: 1, evenOrigin: MAK },
    "03": { endpoints: [MAK, MAD], stops: 0, evenOrigin: MAK },
    "05": { endpoints: [MAK, KAIA], stops: 1, evenOrigin: MAK },
    "07": { endpoints: [MAD, KAIA], stops: 1, evenOrigin: KAIA },
    "08": { endpoints: [MAD, KAIA], stops: 0, evenOrigin: KAIA },
  };

  const ALLOWED_PREFIXES = {
    MAD: new Set(["00", "01", "03", "07", "08"]),
    MAK: new Set(["00", "01", "03", "05"]),
    KAIA: new Set(["05", "07", "08"]),
  };

  const HOME_STATIONS = [MAD, MAK, KAIA];

  const ROUTE_COLOR = { "00": "blue", "01": "blue", "03": "blue", "05": "red", "07": "green", "08": "green" };
  const ROUTE_COLOR_HEX = { blue: "#4472C4", green: "#70AD47", red: "#C00000" };
  const STATION_LETTER = { MAK: "L", MAD: "M", KAIA: "A", KAEC: "K" };

  class TripNumberError extends Error {}

  function decodeTripNumber(tripNoRaw) {
    const tripNo = String(tripNoRaw).trim();
    if (!/^\d{5}$/.test(tripNo)) {
      throw new TripNumberError(`trip number must be 5 digits, got ${JSON.stringify(tripNoRaw)}`);
    }
    const prefix = tripNo.slice(0, 2);
    const family = FAMILY_BY_PREFIX[prefix];
    if (!family) throw new TripNumberError(`unknown route prefix ${prefix} in trip ${tripNo}`);

    const originHour = parseInt(tripNo.slice(2, 4), 10);
    const directionDigit = parseInt(tripNo[4], 10);
    const isEven = directionDigit % 2 === 0;

    const [e0, e1] = family.endpoints;
    const evenOrigin = family.evenOrigin;
    const oddOrigin = evenOrigin === e1 ? e0 : e1;
    const origin = isEven ? evenOrigin : oddOrigin;
    const destination = origin === e1 ? e0 : e1;

    return { tripNo, prefix, originHour, directionDigit, origin, destination, stops: family.stops };
  }

  function homeStationsForTrip(tripNo) {
    const code = decodeTripNumber(tripNo);
    return HOME_STATIONS.filter((hs) => ALLOWED_PREFIXES[hs].has(code.prefix));
  }

  // ---- time helpers: minutes-since-midnight (0-1439) is the canonical internal form ----
  function timeToMinutes(hhmm) {
    if (typeof hhmm === "number") return hhmm;
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  function minutesToTimeStr(mins) {
    mins = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(mins / 60), m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  function minutesBetween(m1, m2) {
    let d = m2 - m1;
    if (d < 0) d += 1440;
    return d;
  }

  // ---- duty_builder.py mirror ----
  const SIGN_IN_BEFORE_MAIN_MIN = 60;
  const SIGN_IN_BEFORE_PASSENGER_MIN = 30;
  const MIN_MAIN_CONNECTION_MIN = 45;
  const TARGET_DUTY_MIN = 7 * 60 + 30;
  const CAP_DUTY_MIN = 8 * 60;
  const SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN = 10;
  const MAX_DUTY_SPAN_MIN = 14 * 60;

  function tryBuild(leg1, leg1Role, leg2, leg2Role) {
    const signIn = leg1.depMin - (leg1Role === "Main" ? SIGN_IN_BEFORE_MAIN_MIN : SIGN_IN_BEFORE_PASSENGER_MIN);
    const signInMod = ((signIn % 1440) + 1440) % 1440;

    if (leg2Role === "Main") {
      const gap = minutesBetween(leg1.arrMin, leg2.depMin);
      if (gap < MIN_MAIN_CONNECTION_MIN) return null;
    }

    const spanToArrival = minutesBetween(signInMod, leg2.arrMin);
    if (spanToArrival > MAX_DUTY_SPAN_MIN) return null;

    let signOutMod, dutyMin, overtime;
    if (spanToArrival <= TARGET_DUTY_MIN) {
      signOutMod = (signInMod + TARGET_DUTY_MIN) % 1440;
      dutyMin = TARGET_DUTY_MIN;
      overtime = false;
    } else {
      signOutMod = (leg2.arrMin + SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN) % 1440;
      dutyMin = minutesBetween(signInMod, signOutMod);
      overtime = spanToArrival > CAP_DUTY_MIN;
    }

    const tier = [leg2Role === "Main" ? 0 : 1, overtime ? 1 : 0, dutyMin];
    return { leg1Role, leg2Role, signIn: signInMod, signOut: signOutMod, dutyMin, overtime, tier };
  }

  function tierLess(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }

  function bestPairing(leg1, leg2Candidates) {
    let best = null;
    for (const leg2 of leg2Candidates) {
      if (leg2.depMin <= leg1.arrMin) continue;
      for (const leg2Role of ["Main", "Passenger"]) {
        const cand = tryBuild(leg1, "Main", leg2, leg2Role);
        if (!cand) continue;
        if (!best || tierLess(cand.tier, best.cand.tier)) best = { leg2, cand };
      }
    }
    return best;
  }

  function buildDutiesForStation(trips, homeStation, drivers, taskCodePrefix) {
    taskCodePrefix = taskCodePrefix || "";
    const allowed = ALLOWED_PREFIXES[homeStation];
    const relevant = trips.filter((t) => allowed.has(t.prefix));

    const byOrigin = {};
    for (const t of relevant) {
      (byOrigin[t.origin] = byOrigin[t.origin] || []).push(t);
    }

    const departing = relevant
      .filter((t) => t.origin === homeStation)
      .slice()
      .sort((a, b) => a.depMin - b.depMin);

    const usedAsReturn = new Set();
    const duties = [];
    const uncovered = [];
    let driverIdx = 0;

    for (const leg1 of departing) {
      const candidates = (byOrigin[leg1.destination] || []).filter(
        (t) => t.destination === homeStation && !usedAsReturn.has(t.tripNo)
      );
      const pairing = bestPairing(leg1, candidates);
      if (!pairing) {
        uncovered.push(leg1);
        continue;
      }
      const { leg2, cand } = pairing;
      usedAsReturn.add(leg2.tripNo);

      if (!drivers.length) {
        uncovered.push(leg1);
        continue;
      }
      const driver = drivers[driverIdx % drivers.length];
      driverIdx += 1;

      const taskCode = `${minutesToTimeStr(cand.signIn).replace(":", "")}/${taskCodePrefix}${driverIdx}`;
      duties.push({
        driver,
        taskCode,
        signIn: cand.signIn,
        signOut: cand.signOut,
        legs: [
          { trip: leg1, role: "Main" },
          { trip: leg2, role: cand.leg2Role },
        ],
        overtime: cand.overtime,
        dutyMin: cand.dutyMin,
        isReserve: false,
      });
    }

    return { duties, uncovered };
  }

  // ---- reserve.py mirror ----
  const RESERVE_DUTY_MIN = 7 * 60;

  function buildReserveDuties(leftoverDrivers, opts) {
    opts = opts || {};
    const dayStart = opts.dayStart != null ? opts.dayStart : timeToMinutes("06:00");
    const dayEnd = opts.dayEnd != null ? opts.dayEnd : timeToMinutes("22:00");
    const shiftIntervalMin = (opts.shiftIntervalHours != null ? opts.shiftIntervalHours : 3) * 60;
    const driversPerShift = opts.driversPerShift != null ? opts.driversPerShift : 4;

    if (!leftoverDrivers.length) return [];

    const shiftStarts = [];
    for (let m = dayStart; m < dayEnd; m += shiftIntervalMin) shiftStarts.push(m);

    return leftoverDrivers.map((driver, i) => {
      const shiftStart = shiftStarts[Math.floor(i / driversPerShift) % shiftStarts.length];
      const signOut = (shiftStart + RESERVE_DUTY_MIN) % 1440;
      return {
        driver,
        taskCode: `${minutesToTimeStr(shiftStart).replace(":", "")}/RSV`,
        signIn: shiftStart,
        signOut,
        legs: [],
        overtime: false,
        dutyMin: RESERVE_DUTY_MIN,
        isReserve: true,
      };
    });
  }

  // ---- Order B (one-row-per-trip) parsing from a SheetJS worksheet-as-array-of-objects ----
  const STATIONS = ["Makkah", "Jeddah", "KAIA", "KAEC", "Madinah"];
  const STATION_CODE = { Makkah: MAK, Jeddah: JED, KAIA: KAIA, KAEC: KAEC, Madinah: MAD };

  function parseTimeCell(v) {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v === "number") {
      // Excel serial time fraction of a day
      const totalMin = Math.round(v * 24 * 60);
      return totalMin;
    }
    if (typeof v === "string") {
      const m = v.trim().match(/^(\d{1,2}):(\d{2})/);
      if (!m) throw new Error(`unrecognized time value ${JSON.stringify(v)}`);
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
    throw new Error(`unrecognized time cell ${JSON.stringify(v)}`);
  }

  function parseOrderBRows(rows) {
    // rows: array of objects keyed by header name (as produced by XLSX.utils.sheet_to_json)
    const trips = [];
    const errors = [];
    rows.forEach((row, i) => {
      const rowNum = i + 2;
      const tripNoRaw = row["Trip No."];
      if (tripNoRaw === undefined || tripNoRaw === null || String(tripNoRaw).trim() === "") return;
      const tripNo = String(tripNoRaw).trim().padStart(5, "0");

      let code;
      try {
        code = decodeTripNumber(tripNo);
      } catch (e) {
        errors.push(`row ${rowNum}: ${e.message}`);
        return;
      }

      const stationTimes = {};
      for (const s of STATIONS) {
        let arr, dep;
        try {
          arr = parseTimeCell(row[`${s} Arr`]);
          dep = parseTimeCell(row[`${s} Dep`]);
        } catch (e) {
          errors.push(`row ${rowNum}: ${e.message}`);
          return;
        }
        if (arr !== null || dep !== null) stationTimes[STATION_CODE[s]] = { arr, dep };
      }

      const originTimes = stationTimes[code.origin];
      const destTimes = stationTimes[code.destination];
      if (!originTimes || originTimes.dep === null) {
        errors.push(`row ${rowNum} (trip ${tripNo}): expected a departure time at origin ${code.origin}`);
        return;
      }
      if (!destTimes || destTimes.arr === null) {
        errors.push(`row ${rowNum} (trip ${tripNo}): expected an arrival time at destination ${code.destination}`);
        return;
      }

      trips.push({
        tripNo,
        origin: code.origin,
        destination: code.destination,
        depMin: originTimes.dep,
        arrMin: destTimes.arr,
        prefix: code.prefix,
      });
    });
    return { trips, errors };
  }

  const OrderBEngine = {
    decodeTripNumber,
    homeStationsForTrip,
    ALLOWED_PREFIXES,
    HOME_STATIONS,
    ROUTE_COLOR,
    ROUTE_COLOR_HEX,
    STATION_LETTER,
    timeToMinutes,
    minutesToTimeStr,
    minutesBetween,
    buildDutiesForStation,
    buildReserveDuties,
    parseOrderBRows,
    TripNumberError,
    _constants: {
      SIGN_IN_BEFORE_MAIN_MIN,
      SIGN_IN_BEFORE_PASSENGER_MIN,
      MIN_MAIN_CONNECTION_MIN,
      TARGET_DUTY_MIN,
      CAP_DUTY_MIN,
      SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN,
      RESERVE_DUTY_MIN,
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = OrderBEngine;
  } else {
    root.OrderBEngine = OrderBEngine;
  }
})(typeof window !== "undefined" ? window : globalThis);
