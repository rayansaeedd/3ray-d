/*
 * Mirrors order_b_engine/joint_demo.py exactly, against the same real 96-trip ground truth,
 * to prove the JS port matches the Python joint scheduler's coverage guarantee.
 * Run with: node web/joint_scheduler.test.js
 */
const fs = require("fs");
const path = require("path");
const OrderBEngine = require("./order_b_engine.js");
const JointScheduler = require("./joint_scheduler.js");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

const groundTruthPath = path.join(__dirname, "..", "order_b_engine", "_test_data", "all_trips_ground_truth.json");
const raw = JSON.parse(fs.readFileSync(groundTruthPath, "utf8"));

const stationNameToCode = { Makkah: "MAK", Jeddah: "JED", KAIA: "KAIA", KAEC: "KAEC", Madinah: "MAD" };

const trips = Object.entries(raw).map(([tripNo, rec]) => {
  const code = OrderBEngine.decodeTripNumber(tripNo);
  let depMin = null, arrMin = null;
  for (const [key, value] of Object.entries(rec)) {
    for (const [stationName, stationCode] of Object.entries(stationNameToCode)) {
      if (key === `${stationName} Dep` && stationCode === code.origin) depMin = OrderBEngine.timeToMinutes(value);
      if (key === `${stationName} Arr` && stationCode === code.destination) arrMin = OrderBEngine.timeToMinutes(value);
    }
  }
  return { tripNo, origin: code.origin, destination: code.destination, depMin, arrMin, prefix: code.prefix };
});

console.log(`Loaded ${trips.length} real trips (all 6 prefixes, WEEK pattern)`);

const result = JointScheduler.buildJointSchedule(trips);
const countsByStation = Object.fromEntries(Object.entries(result.dutiesByStation).map(([k, v]) => [k, v.length]));
const totalDuties = Object.values(countsByStation).reduce((a, b) => a + b, 0);
console.log("Duties by station:", countsByStation);
console.log("Total duties:", totalDuties);

// Sweep duties are mandatory overhead added on top of the loaded trips (see buildSweepDuties).
// MAK's sweep used to consume one real shuttle trip (05085) as its own Main-role return leg,
// which shifted what was left for the shuttle chain-selection algorithm and left a different
// trip (05140) without a same-day partner -- fixed by giving MAK's sweep no return leg at all
// (driver goes on Reserve after instead), so coverage is back to strict.
assert(result.uncovered.length === 0, `expected 0 uncovered, got ${result.uncovered.map((t) => t.tripNo)}`);

const mainCount = {};
for (const duties of Object.values(result.dutiesByStation)) {
  for (const duty of duties) {
    for (const leg of duty.legs) {
      if (leg.role === "Main") mainCount[leg.trip.tripNo] = (mainCount[leg.trip.tripNo] || 0) + 1;
    }
  }
}
const missing = trips.filter((t) => !mainCount[t.tripNo]).map((t) => t.tripNo);
const doubled = Object.entries(mainCount).filter(([, count]) => count > 1).map(([tripNo]) => tripNo);
assert(missing.length === 0, `trips with NO main driver: ${missing}`);
assert(doubled.length === 0, `trips with 2+ main drivers (double-booked): ${doubled}`);

console.log(`PASS: all ${trips.length} trips have exactly one Main driver, zero uncovered, zero double-booked.`);

const sweepDuties = Object.values(result.dutiesByStation).flat().filter((d) => d.legs.length && d.legs[0].trip.prefix === "SWEEP");
assert(sweepDuties.length === 4, `expected 4 sweep duties (MAD, MAK, KAIA x2), got ${sweepDuties.length}`);
const sweepTripNos = new Set(sweepDuties.map((d) => d.legs[0].trip.tripNo));
const expectedSweepNos = new Set(["19065", "12050", "14351", "14950"]);
assert(
  sweepTripNos.size === expectedSweepNos.size && [...sweepTripNos].every((t) => expectedSweepNos.has(t)),
  `unexpected sweep trip numbers: ${[...sweepTripNos]}`
);
assert(sweepDuties.every((d) => !d.overtime), "sweep duty violates zero-overtime policy");
console.log("PASS: all 4 sweep duties built with the correct fixed trip numbers, zero overtime.");

// MAK's sweep has no return leg at all (driver goes on Reserve after instead of picking up a
// real shuttle trip) -- verify that's actually what got built, not a stale 2-leg duty.
const makSweep = sweepDuties.find((d) => d.legs[0].trip.tripNo === "12050");
assert(makSweep.legs.length === 1, `expected MAK's sweep to have no return leg, got ${makSweep.legs.length} legs`);
console.log("PASS: MAK's sweep has no return leg (Reserve after instead).");

// Every driver's day must be at least 7:00 -- a sweep's natural length (sweep leg + earliest
// available return, no slack) came in as short as ~5:09 on real data before this floor was
// added, so it gets padded with Reserve time; verify that floor holds and the existing 8:00
// zero-overtime ceiling still caps the other end.
assert(
  sweepDuties.every((d) => d.dutyMin >= 420 && d.dutyMin <= 480),
  `sweep duty out of the 7:00-8:00 range: ${sweepDuties.map((d) => `${d.taskCode}=${d.dutyMin}min`)}`
);
console.log("PASS: every sweep duty is between 7:00 and 8:00.");

const overtimeDuties = Object.values(result.dutiesByStation)
  .flat()
  .filter((d) => d.overtime)
  .map((d) => d.taskCode);
assert(overtimeDuties.length === 0, `zero-overtime policy violated by: ${overtimeDuties}`);
console.log("PASS: zero overtime duties (station-wide policy).");

// Cross-check against the Python run's exact station split (both use the same tie-break
// order -- trips_a processed in departure-time order -- so this should match exactly, not
// just "close enough").
const expectedCounts = { MAK: 18, MAD: 16, KAIA: 12 };
for (const station of Object.keys(expectedCounts)) {
  assert(
    countsByStation[station] === expectedCounts[station],
    `station ${station}: expected ${expectedCounts[station]} duties (matching the Python run), got ${countsByStation[station]}`
  );
}
console.log("PASS: station split matches the Python run exactly (18/16/12).");

// Shuttle-specific: the whole point of this rework was killing the 5-6h idle-gap problem.
// Every internal gap between consecutive Main legs of a shuttle duty must be reasonable --
// generously capped at 3h to leave room for real-world timetable irregularities (the actual
// worst case on real data is ~2.5h, at the very start of the operating day) while still
// catching a regression back toward the original multi-hour-wait bug.
const shuttleDuties = Object.values(result.dutiesByStation).flat().filter((d) => d.legs.some((l) => l.trip.prefix === "05"));
assert(shuttleDuties.length > 0, "expected at least one shuttle duty in this dataset");
let maxShuttleGap = 0;
for (const d of shuttleDuties) {
  for (let i = 0; i < d.legs.length - 1; i++) {
    const gap = OrderBEngine.minutesBetween(d.legs[i].trip.arrMin, d.legs[i + 1].trip.depMin);
    maxShuttleGap = Math.max(maxShuttleGap, gap);
  }
}
assert(maxShuttleGap <= 180, `shuttle duty has a ${maxShuttleGap}-min internal gap -- the 5-6h idle problem may have regressed`);
console.log(`PASS: ${shuttleDuties.length} shuttle duties built, largest internal gap ${maxShuttleGap}min (well under the old 5-6h problem).`);

// reservePosition: a round-trip pair padded to the target duty length must actually flag which
// side (before/after the 2 legs) got the padding, so the UI can show a RESERVE block there --
// otherwise a driver has no way to know they're on standby before or after their trip.
const reservePairs = shuttleDuties.filter((d) => d.legs.length === 2 && d.reservePosition);
assert(reservePairs.length > 0, "expected at least one shuttle round-trip pair padded with Reserve time");
assert(reservePairs.every((d) => d.reservePosition === "before" || d.reservePosition === "after"));
const beforeCount = reservePairs.filter((d) => d.reservePosition === "before").length;
const afterCount = reservePairs.filter((d) => d.reservePosition === "after").length;
console.log(`PASS: ${reservePairs.length} shuttle pair(s) correctly flagged with reservePosition (${beforeCount} before, ${afterCount} after).`);
