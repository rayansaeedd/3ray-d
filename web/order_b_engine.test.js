/*
 * Mirrors order_b_engine/demo.py scenario 1 exactly, to prove the JS port matches the Python
 * engine on the same real, already-verified example (Ziyad's duty, task 0630/8L).
 * Run with: node web/order_b_engine.test.js
 */
const OrderBEngine = require("./order_b_engine.js");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

function t(hhmm) {
  return OrderBEngine.timeToMinutes(hhmm);
}

// same trips as order_b_engine/demo.py
const TRIP_01071 = { tripNo: "01071", origin: "MAD", destination: "MAK", depMin: t("07:30"), arrMin: t("09:50"), prefix: "01" };
const TRIP_01120 = { tripNo: "01120", origin: "MAK", destination: "MAD", depMin: t("12:00"), arrMin: t("14:20"), prefix: "01" };
const TRIP_00060 = { tripNo: "00060", origin: "MAK", destination: "MAD", depMin: t("06:00"), arrMin: t("08:25"), prefix: "00" };
const TRIP_05200 = { tripNo: "05200", origin: "MAK", destination: "KAIA", depMin: t("20:35"), arrMin: t("21:29"), prefix: "05" };
const TRIP_07161 = { tripNo: "07161", origin: "MAD", destination: "KAIA", depMin: t("16:00"), arrMin: t("17:54"), prefix: "07" };
const TRIP_07230 = { tripNo: "07230", origin: "KAIA", destination: "MAD", depMin: t("23:00"), arrMin: t("00:54"), prefix: "07" };

console.log("=== Scenario 1: reproduce Ziyad's real, already-verified duty ===");
{
  const ziyad = { driverId: "6868855", name: "ZIYAD SALEH HAMZAH ALREHAILI", phone: "562934948", homeStation: "MAD" };
  const { duties, uncovered } = OrderBEngine.buildDutiesForStation([TRIP_01071, TRIP_01120], "MAD", [ziyad]);

  assert(duties.length === 1, `expected 1 duty, got ${duties.length}`);
  const d = duties[0];
  assert(OrderBEngine.minutesToTimeStr(d.signIn) === "06:30", `sign_in ${OrderBEngine.minutesToTimeStr(d.signIn)} != 06:30`);
  assert(OrderBEngine.minutesToTimeStr(d.signOut) === "14:30", `sign_out ${OrderBEngine.minutesToTimeStr(d.signOut)} != 14:30`);
  assert(d.legs.length === 2, "expected 2 legs");
  assert(d.legs[0].trip.tripNo === "01071" && d.legs[0].role === "Main", "leg1 mismatch");
  assert(d.legs[1].trip.tripNo === "01120" && d.legs[1].role === "Main", "leg2 mismatch");
  assert(d.overtime === false, "should not be flagged overtime");
  assert(d.dutyMin === 480, `duty length ${d.dutyMin} != 480min`);
  assert(uncovered.length === 0, "expected no uncovered trips");

  console.log(
    `PASS: sign_in=${OrderBEngine.minutesToTimeStr(d.signIn)} sign_out=${OrderBEngine.minutesToTimeStr(d.signOut)} ` +
    `legs=${d.legs.map((l) => l.trip.tripNo)} roles=${d.legs.map((l) => l.role)} duty=${d.dutyMin}min overtime=${d.overtime}`
  );
}

console.log("\n=== Scenario 2: uncovered trips ===");
{
  const driverMak = { driverId: "1000001", name: "TEST DRIVER MAK", phone: "500000001", homeStation: "MAK" };
  const { duties, uncovered } = OrderBEngine.buildDutiesForStation([TRIP_00060, TRIP_05200], "MAK", [driverMak]);
  assert(duties.length === 0, "expected 0 duties");
  assert(uncovered.length === 2, "expected 2 uncovered");
  console.log(`MAK station: ${duties.length} duties, ${uncovered.length} uncovered (${uncovered.map((t) => t.tripNo)})`);

  // 07161's only same-day return (07230) would need a ~9:54 duty span -- rejected outright
  // under the zero-overtime policy, so it's uncovered instead of built with an overtime flag.
  const driverKaia = { driverId: "1000002", name: "TEST DRIVER KAIA", phone: "500000002", homeStation: "MAD" };
  const r2 = OrderBEngine.buildDutiesForStation([TRIP_07161, TRIP_07230], "MAD", [driverKaia]);
  assert(r2.duties.length === 0, "expected 0 duties -- would need overtime");
  assert(r2.uncovered.length === 1 && r2.uncovered[0].tripNo === "07161", "expected 07161 uncovered");
  console.log(`MAD/KAIA pairing: ${r2.duties.length} duties, ${r2.uncovered.length} uncovered (${r2.uncovered.map((t) => t.tripNo)})`);
}

console.log("\n=== Scenario 3: reserve shift spread ===");
{
  const leftover = Array.from({ length: 10 }, (_, i) => ({
    driverId: `200000${i}`, name: `RESERVE DRIVER ${i}`, phone: `5000000${String(i).padStart(2, "0")}`, homeStation: "MAD",
  }));
  const reserveDuties = OrderBEngine.buildReserveDuties(leftover, { driversPerShift: 4, shiftIntervalHours: 3 });
  assert(reserveDuties.every((rd) => rd.dutyMin === 420), "all reserve duties should be 7:00");
  reserveDuties.slice(0, 5).forEach((rd) => {
    console.log(`  ${rd.driver.name}: sign_in=${OrderBEngine.minutesToTimeStr(rd.signIn)} sign_out=${OrderBEngine.minutesToTimeStr(rd.signOut)}`);
  });
}

console.log("\nAll JS engine checks passed -- matches order_b_engine/demo.py exactly.");
