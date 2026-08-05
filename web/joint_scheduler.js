/*
 * JavaScript port of order_b_engine/joint_scheduler.py -- deliberate line-for-line mirror,
 * not an independent reimplementation. Cross-checked against the same real 96-trip WEEK
 * dataset used to validate the Python version; see joint_scheduler.test.js.
 *
 * See the Python module's docstring for the full rationale (why this exists instead of three
 * independent per-station runs, and the two-phase Main+Main / Main+Passenger design -- a
 * single-matching-pass version was tried first and silently miscounted coverage because a
 * Passenger leg doesn't provide Main-driver coverage for the trip it rides on).
 *
 * Works both in the browser (window.JointScheduler) and under Node (module.exports).
 */
(function (root) {
  "use strict";

  const OrderBEngine = typeof module !== "undefined" && module.exports
    ? require("./order_b_engine.js")
    : window.OrderBEngine;

  const { minutesToTimeStr, minutesBetween, STATION_LETTER, timeToMinutes } = OrderBEngine;
  const c = OrderBEngine._constants;

  const FAMILIES = [
    [new Set(["00", "01", "03"]), "MAK", "MAD"],
    [new Set(["05"]), "MAK", "KAIA"],
    [new Set(["07", "08"]), "MAD", "KAIA"],
  ];

  function addMinutes(m, delta) {
    return ((m + delta) % 1440 + 1440) % 1440;
  }

  // Plain same-day check (NOT wraparound-safe) -- deliberately different from
  // OrderBEngine.minutesBetween, which adds 24h on a negative difference. That's correct for
  // a duty's own last leg arriving just past midnight, but wrong for deciding whether two
  // independent trips can chain: without this guard a trip departing at 06:00 gets accepted
  // as a same-day return for one that doesn't arrive until 21:55, producing a ~14h phantom
  // duty. Confirmed by hitting this exact failure against real data in the Python version
  // before adding the guard there; ported here to match.
  function sameDayDepBeforeArr(depMin, arrMin) {
    return depMin > arrMin;
  }

  function tryBuild(leg1, leg1Role, leg2, leg2Role) {
    const signIn = addMinutes(leg1.depMin, -(leg1Role === "Main" ? c.SIGN_IN_BEFORE_MAIN_MIN : c.SIGN_IN_BEFORE_PASSENGER_MIN));

    if (leg2Role === "Main") {
      const gap = minutesBetween(leg1.arrMin, leg2.depMin);
      if (gap < c.MIN_MAIN_CONNECTION_MIN) return null;
    }

    const spanToArrival = minutesBetween(signIn, leg2.arrMin);
    if (spanToArrival > 14 * 60) return null; // MAX_DUTY_SPAN_MIN

    let signOut, dutyMin, overtime;
    if (spanToArrival <= c.TARGET_DUTY_MIN) {
      signOut = addMinutes(signIn, c.TARGET_DUTY_MIN);
      dutyMin = c.TARGET_DUTY_MIN;
      overtime = false;
    } else {
      signOut = addMinutes(leg2.arrMin, c.SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN);
      dutyMin = minutesBetween(signIn, signOut);
      overtime = spanToArrival > c.CAP_DUTY_MIN;
    }

    const tier = [leg2Role === "Main" ? 0 : 1, overtime ? 1 : 0, dutyMin];
    return { leg1Role, leg2Role, signIn, signOut, dutyMin, overtime, tier };
  }

  function tierLess(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }

  function bestMainMainEdge(ta, tb) {
    const options = [];
    if (sameDayDepBeforeArr(tb.depMin, ta.arrMin)) {
      const cand = tryBuild(ta, "Main", tb, "Main");
      if (cand) options.push(["a_out", cand]);
    }
    if (sameDayDepBeforeArr(ta.depMin, tb.arrMin)) {
      const cand = tryBuild(tb, "Main", ta, "Main");
      if (cand) options.push(["b_out", cand]);
    }
    if (!options.length) return null;
    options.sort((x, y) => (tierLess(x[1].tier, y[1].tier) ? -1 : 1));
    return options[0];
  }

  function buildMainMainAdjacency(tripsA, tripsB) {
    const adj = {};
    for (const t of tripsA.concat(tripsB)) adj[t.tripNo] = [];
    for (const ta of tripsA) {
      for (const tb of tripsB) {
        const edge = bestMainMainEdge(ta, tb);
        if (!edge) continue;
        const [direction, cand] = edge;
        adj[ta.tripNo].push([tb, direction, cand]);
        adj[tb.tripNo].push([ta, direction, cand]);
      }
    }
    for (const tripNo in adj) adj[tripNo].sort((x, y) => (tierLess(x[2].tier, y[2].tier) ? -1 : 1));
    return adj;
  }

  function kuhnAugment(nodeNo, adj, match, visited) {
    for (const [other, direction, cand] of adj[nodeNo] || []) {
      if (visited.has(other.tripNo)) continue;
      visited.add(other.tripNo);
      if (!match[other.tripNo] || kuhnAugment(match[other.tripNo][0], adj, match, visited)) {
        match[nodeNo] = [other.tripNo, direction, cand];
        match[other.tripNo] = [nodeNo, direction, cand];
        return true;
      }
    }
    return false;
  }

  function makeDuty(outbound, ret, cand, homeStation) {
    const awayLetter = STATION_LETTER[outbound.destination] || "?";
    const taskCode = `${minutesToTimeStr(cand.signIn).replace(":", "")}/${Math.floor(cand.dutyMin / 60)}${awayLetter}`;
    const blankDriver = { driverId: "", name: "", phone: "", homeStation };
    return {
      driver: blankDriver,
      taskCode,
      signIn: cand.signIn,
      signOut: cand.signOut,
      legs: [
        { trip: outbound, role: "Main" },
        { trip: ret, role: cand.leg2Role },
      ],
      overtime: cand.overtime,
      dutyMin: cand.dutyMin,
      isReserve: false,
    };
  }

  function solveFamily(tripsA, tripsB, stationA, stationB) {
    tripsA = tripsA.slice().sort((a, b) => a.depMin - b.depMin);
    tripsB = tripsB.slice().sort((a, b) => a.depMin - b.depMin);
    const byNo = {};
    for (const t of tripsA.concat(tripsB)) byNo[t.tripNo] = t;

    const adj = buildMainMainAdjacency(tripsA, tripsB);
    const match = {};
    for (const ta of tripsA) {
      if (match[ta.tripNo]) continue;
      kuhnAugment(ta.tripNo, adj, match, new Set([ta.tripNo]));
    }

    const dutiesA = [];
    const dutiesB = [];
    const seen = new Set();
    const covered = new Set();
    for (const tripNo in match) {
      const [otherNo, , cand] = match[tripNo];
      const pairKey = [tripNo, otherNo].sort().join("|");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const t1 = byNo[tripNo], t2 = byNo[otherNo];
      const [outbound, ret] = t1.depMin <= t2.depMin ? [t1, t2] : [t2, t1];
      const homeStation = outbound.origin === stationA ? stationA : stationB;
      const duty = makeDuty(outbound, ret, cand, homeStation);
      (homeStation === stationA ? dutiesA : dutiesB).push(duty);
      covered.add(tripNo);
      covered.add(otherNo);
    }

    const uncovered = [];
    for (const trip of tripsA.concat(tripsB)) {
      if (covered.has(trip.tripNo)) continue;
      const homeStation = trip.origin === stationA ? stationA : stationB;
      const returnPool = trip.origin === stationA ? tripsB : tripsA;
      let best = null;
      for (const other of returnPool) {
        if (!sameDayDepBeforeArr(other.depMin, trip.arrMin)) continue;
        const cand = tryBuild(trip, "Main", other, "Passenger");
        if (cand && (!best || tierLess(cand.tier, best[1].tier))) best = [other, cand];
      }
      if (!best) {
        uncovered.push(trip);
        continue;
      }
      const [other, cand] = best;
      const duty = makeDuty(trip, other, cand, homeStation);
      (homeStation === stationA ? dutiesA : dutiesB).push(duty);
      covered.add(trip.tripNo);
    }

    return { dutiesA, dutiesB, uncovered };
  }

  function buildJointSchedule(trips) {
    const dutiesByStation = { MAK: [], MAD: [], KAIA: [] };
    const allUncovered = [];

    for (const [prefixes, stationA, stationB] of FAMILIES) {
      const familyTrips = trips.filter((t) => prefixes.has(t.prefix));
      const tripsA = familyTrips.filter((t) => t.origin === stationA);
      const tripsB = familyTrips.filter((t) => t.origin === stationB);
      const { dutiesA, dutiesB, uncovered } = solveFamily(tripsA, tripsB, stationA, stationB);
      dutiesByStation[stationA].push(...dutiesA);
      dutiesByStation[stationB].push(...dutiesB);
      allUncovered.push(...uncovered);
    }

    return { dutiesByStation, uncovered: allUncovered };
  }

  const JointScheduler = { buildJointSchedule, FAMILIES };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = JointScheduler;
  } else {
    root.JointScheduler = JointScheduler;
  }
})(typeof window !== "undefined" ? window : globalThis);
