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

// Cross-check against the Python run's exact station split (both use the same tie-break
// order -- trips_a processed in departure-time order -- so this should match exactly, not
// just "close enough").
const expectedCounts = { MAK: 16, MAD: 16, KAIA: 16 };
for (const station of Object.keys(expectedCounts)) {
  assert(
    countsByStation[station] === expectedCounts[station],
    `station ${station}: expected ${expectedCounts[station]} duties (matching the Python run), got ${countsByStation[station]}`
  );
}
console.log("PASS: station split matches the Python run exactly (16/16/16).");
