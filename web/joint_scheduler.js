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
    // Would need overtime to cover -- never allowed (zero-overtime policy), so this pairing
    // isn't a candidate at all. The trip may end up uncovered instead of getting an overtime
    // duty; that's the intended tradeoff, not a bug.
    if (spanToArrival > c.CAP_DUTY_MIN) return null;

    let signOut, dutyMin;
    if (spanToArrival <= c.TARGET_DUTY_MIN) {
      signOut = addMinutes(signIn, c.TARGET_DUTY_MIN);
      dutyMin = c.TARGET_DUTY_MIN;
    } else {
      signOut = addMinutes(leg2.arrMin, c.SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN);
      dutyMin = minutesBetween(signIn, signOut);
    }
    const overtime = false;

    // lower is better: (role preference, duty length) -- overtime dropped out of the tier since
    // a candidate can no longer be built with overtime=true at all.
    const tier = [leg2Role === "Main" ? 0 : 1, dutyMin];
    return { leg1Role, leg2Role, signIn, signOut, dutyMin, overtime, tier };
  }

  function tierLess(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }

  // ---------------------------------------------------------------------------------------
  // Shuttle (05, MAK<->KAIA) duties: NOT built via the general Main+Main bipartite matching
  // below. See joint_scheduler.py's matching block comment for the full rationale (short
  // version: shuttle legs are short and run every ~2h, so pairing "any valid same-day return"
  // left a driver idle for 5-6h between two legs that were each individually valid but far
  // apart -- the matching tier never saw the gap, only the padded/flattened duty length).
  //
  // Pattern 1 (chain): exactly 4 legs back-to-back, alternating direction, sign-in 30 min
  //   before the first leg (not the usual 60).
  // Pattern 2 (pair + Reserve): one round-trip pair, normal 60-min sign-in, padded to the 7:30
  //   target with Reserve time -- after the pair by default (exactly what tryBuild already does
  //   when a pairing finishes early), before it only when "after" would push sign-out past
  //   midnight.
  const SHUTTLE_SIGN_IN_BEFORE_CHAIN_MIN = 30;
  const SHUTTLE_CHAIN_LEGS = 4;

  function wrapsMidnight(startMin, endMin) {
    return endMin < startMin;
  }

  function tryExtendShuttleChain(current, poolByOrigin, chainTripNos) {
    const candidates = (poolByOrigin[current.destination] || []).filter(
      (t) => !chainTripNos.has(t.tripNo)
        && sameDayDepBeforeArr(t.depMin, current.arrMin)
        && minutesBetween(current.arrMin, t.depMin) >= c.MIN_MAIN_CONNECTION_MIN
    );
    if (!candidates.length) return null;
    return candidates.reduce((best, t) => (t.depMin < best.depMin ? t : best));
  }

  function tryBuildShuttleChain(leg1, poolByOrigin) {
    const chain = [leg1];
    const chainTripNos = new Set([leg1.tripNo]);
    let current = leg1;
    for (let i = 0; i < SHUTTLE_CHAIN_LEGS - 1; i++) {
      const nxt = tryExtendShuttleChain(current, poolByOrigin, chainTripNos);
      if (!nxt) return null;
      chain.push(nxt);
      chainTripNos.add(nxt.tripNo);
      current = nxt;
    }

    const signIn = addMinutes(leg1.depMin, -SHUTTLE_SIGN_IN_BEFORE_CHAIN_MIN);
    const lastArr = chain[chain.length - 1].arrMin;
    const span = minutesBetween(signIn, lastArr);
    if (span > c.CAP_DUTY_MIN) return null; // would need overtime -- never allowed
    const signOut = addMinutes(lastArr, c.SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN);
    const dutyMin = minutesBetween(signIn, signOut);
    return [chain, signIn, signOut, dutyMin];
  }

  // Every structurally valid 4-leg chain, one attempt per possible starting trip, independent
  // of each other (no shared claimed-set while enumerating) -- see
  // _enumerate_shuttle_chains in joint_scheduler.py for why enumerate-then-select beats a
  // single greedy claiming pass here.
  function enumerateShuttleChains(allTrips, poolByOrigin) {
    const chains = [];
    for (const leg1 of allTrips) {
      const result = tryBuildShuttleChain(leg1, poolByOrigin);
      if (result) chains.push(result);
    }
    return chains;
  }

  function tryBuildShuttlePairWithReserve(leg1, poolByOrigin, claimed) {
    const candidates = (poolByOrigin[leg1.destination] || []).filter(
      (t) => !claimed.has(t.tripNo)
        && t.destination === leg1.origin
        && sameDayDepBeforeArr(t.depMin, leg1.arrMin)
        && minutesBetween(leg1.arrMin, t.depMin) >= c.MIN_MAIN_CONNECTION_MIN
    );
    if (!candidates.length) return null;
    const leg2 = candidates.reduce((best, t) => (t.depMin < best.depMin ? t : best));

    const signInFwd = addMinutes(leg1.depMin, -c.SIGN_IN_BEFORE_MAIN_MIN);
    const spanFwd = minutesBetween(signInFwd, leg2.arrMin);
    if (spanFwd <= c.CAP_DUTY_MIN) {
      let signOutFwd, reservePosition;
      if (spanFwd <= c.TARGET_DUTY_MIN) {
        signOutFwd = addMinutes(signInFwd, c.TARGET_DUTY_MIN);
        reservePosition = "after";
      } else {
        signOutFwd = addMinutes(leg2.arrMin, c.SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN);
        reservePosition = null;
      }
      if (!wrapsMidnight(signInFwd, signOutFwd)) {
        return [leg1, leg2, signInFwd, signOutFwd, minutesBetween(signInFwd, signOutFwd), reservePosition];
      }
    }

    // Reserve-before: anchor from the return leg's own arrival (no sign-out buffer -- a
    // computed backward target, not a "wrap up after arriving" pad) so the total is exactly
    // the 7:30 target and sign-out never needs to cross midnight.
    const signOutBwd = leg2.arrMin;
    const signInBwd = addMinutes(signOutBwd, -c.TARGET_DUTY_MIN);
    return [leg1, leg2, signInBwd, signOutBwd, c.TARGET_DUTY_MIN, "before"];
  }

  function makeShuttleDuty(legs, signIn, signOut, dutyMin, homeStation, reservePosition) {
    const awayLetter = STATION_LETTER[legs[0].destination] || "?";
    const taskCode = `${minutesToTimeStr(signIn).replace(":", "")}/${Math.floor(dutyMin / 60)}${awayLetter}`;
    const blankDriver = { driverId: "", name: "", phone: "", homeStation };
    return {
      driver: blankDriver,
      taskCode,
      signIn,
      signOut,
      legs: legs.map((t) => ({ trip: t, role: "Main" })),
      overtime: false,
      dutyMin,
      isReserve: false,
      reservePosition: reservePosition || null,
    };
  }

  function solveShuttleFamily(tripsA, tripsB, stationA, stationB) {
    const allTrips = tripsA.concat(tripsB).slice().sort((a, b) => a.depMin - b.depMin);
    const poolByOrigin = {};
    for (const t of allTrips) {
      (poolByOrigin[t.origin] = poolByOrigin[t.origin] || []).push(t);
    }

    const claimed = new Set();
    const dutiesA = [];
    const dutiesB = [];

    const allChains = enumerateShuttleChains(allTrips, poolByOrigin);
    allChains.sort((x, y) => y[0][0].depMin - x[0][0].depMin); // latest chain-start first
    for (const [legs, signIn, signOut, dutyMin] of allChains) {
      if (legs.some((t) => claimed.has(t.tripNo))) continue;
      legs.forEach((t) => claimed.add(t.tripNo));
      const duty = makeShuttleDuty(legs, signIn, signOut, dutyMin, legs[0].origin);
      (legs[0].origin === stationA ? dutiesA : dutiesB).push(duty);
    }

    for (const leg1 of allTrips) {
      if (claimed.has(leg1.tripNo)) continue;
      const pair = tryBuildShuttlePairWithReserve(leg1, poolByOrigin, claimed);
      if (!pair) continue;
      const [l1, l2, signIn, signOut, dutyMin, reservePosition] = pair;
      claimed.add(l1.tripNo);
      claimed.add(l2.tripNo);
      const duty = makeShuttleDuty([l1, l2], signIn, signOut, dutyMin, leg1.origin, reservePosition);
      (leg1.origin === stationA ? dutiesA : dutiesB).push(duty);
    }

    const uncovered = allTrips.filter((t) => !claimed.has(t.tripNo));
    return { dutiesA, dutiesB, uncovered };
  }

  // Sweep ("monitoring") trains: one mandatory track-inspection run per row below, always
  // departing before commercial operation starts. See joint_scheduler.py's _build_sweep_duties
  // for the full rationale -- this is a line-for-line mirror.
  const SWEEP_ROUTES = [
    // [homeStation, awayStation, tripNo, durationMin, returnPrefixes, returnRole]
    ["MAD", "KAIA", "19065", 120, new Set(["07", "08"]), "Passenger"],
    ["MAK", "KAIA", "12050", 60, new Set(["05"]), "Main"],
    ["KAIA", "MAK", "14351", 100, new Set(["05"]), "Passenger"],
    ["KAIA", "MAD", "14950", 150, new Set(["07", "08"]), "Passenger"],
  ];

  function buildSweepDuties(trips) {
    const dutiesByStation = { MAK: [], MAD: [], KAIA: [] };
    const claimed = new Set();

    for (const [homeStation, awayStation, tripNo, durationMin, returnPrefixes, returnRole] of SWEEP_ROUTES) {
      const homeTrips = trips.filter((t) => t.origin === homeStation);
      if (!homeTrips.length) continue;
      const anchor = homeTrips.reduce((min, t) => Math.min(min, t.depMin), Infinity);
      const sweepDep = addMinutes(anchor, -60);
      const sweepArr = addMinutes(sweepDep, durationMin);
      const signIn = addMinutes(sweepDep, -c.SIGN_IN_BEFORE_MAIN_MIN);

      const sweepTrip = { tripNo, origin: homeStation, destination: awayStation, depMin: sweepDep, arrMin: sweepArr, prefix: "SWEEP" };
      const legs = [{ trip: sweepTrip, role: "Main" }];

      const candidates = trips
        .filter((t) => returnPrefixes.has(t.prefix) && t.origin === awayStation && t.destination === homeStation
          && sameDayDepBeforeArr(t.depMin, sweepArr)
          && minutesBetween(sweepArr, t.depMin) >= c.MIN_MAIN_CONNECTION_MIN
          && minutesBetween(signIn, t.arrMin) <= c.CAP_DUTY_MIN)
        .sort((a, b) => a.depMin - b.depMin);

      let signOut;
      if (candidates.length) {
        const returnTrip = candidates[0];
        legs.push({ trip: returnTrip, role: returnRole });
        signOut = addMinutes(returnTrip.arrMin, c.SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN);
        if (returnRole === "Main") claimed.add(returnTrip.tripNo);
      } else {
        signOut = addMinutes(sweepArr, c.SIGN_OUT_BUFFER_AFTER_ARRIVAL_MIN);
      }

      const dutyMin = minutesBetween(signIn, signOut);
      const awayLetter = STATION_LETTER[awayStation] || "?";
      const taskCode = `${minutesToTimeStr(signIn).replace(":", "")}/${Math.floor(dutyMin / 60)}${awayLetter}`;
      const blankDriver = { driverId: "", name: "", phone: "", homeStation };
      dutiesByStation[homeStation].push({
        driver: blankDriver, taskCode, signIn, signOut, legs, overtime: false, dutyMin, isReserve: false,
      });
    }

    return { dutiesByStation, claimed };
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

    // Sweep duties are built first and independently of the family loop below -- they're
    // synthesized, not drawn from `trips` at all, except for whichever real trip becomes a
    // sweep's Main-role return leg (only the MAK route does this), which has to be pulled out of
    // its family's pool so the normal solver doesn't also hand it to a different driver.
    const { dutiesByStation: sweepDutiesByStation, claimed: claimedBySweep } = buildSweepDuties(trips);
    for (const station in sweepDutiesByStation) {
      dutiesByStation[station].push(...sweepDutiesByStation[station]);
    }

    for (const [prefixes, stationA, stationB] of FAMILIES) {
      const familyTrips = trips.filter((t) => prefixes.has(t.prefix) && !claimedBySweep.has(t.tripNo));
      const tripsA = familyTrips.filter((t) => t.origin === stationA);
      const tripsB = familyTrips.filter((t) => t.origin === stationB);

      // Shuttle gets its own duty-shaping rules (4-leg chains / pair+Reserve) instead of the
      // general Main+Main matching -- see solveShuttleFamily's comment block for why.
      const isShuttle = prefixes.size === 1 && prefixes.has("05");
      const { dutiesA, dutiesB, uncovered } = isShuttle
        ? solveShuttleFamily(tripsA, tripsB, stationA, stationB)
        : solveFamily(tripsA, tripsB, stationA, stationB);

      dutiesByStation[stationA].push(...dutiesA);
      dutiesByStation[stationB].push(...dutiesB);
      allUncovered.push(...uncovered);
    }

    // Always display top-to-bottom in the order the day actually runs: earliest sign-in first.
    // A station's duties come from up to two different shared families (e.g. MAK gets both
    // 00/01/03 and 05 duties), pushed one family at a time above, so without this sort a 6:00
    // duty from the second family could land below an 8:00 duty from the first.
    for (const station in dutiesByStation) {
      dutiesByStation[station].sort((a, b) => a.signIn - b.signIn);
    }
    allUncovered.sort((a, b) => a.depMin - b.depMin);

    return { dutiesByStation, uncovered: allUncovered };
  }

  const JointScheduler = { buildJointSchedule, FAMILIES };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = JointScheduler;
  } else {
    root.JointScheduler = JointScheduler;
  }
})(typeof window !== "undefined" ? window : globalThis);
