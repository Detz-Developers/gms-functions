{/*}
/// <reference types="cypress" />
import { db, login } from "../support/firebase.js";
import { ref, set, get, DatabaseReference, DataSnapshot } from "firebase/database";

describe("Firebase Batteries Rules", () => {
  const batteryRef = (id: string): DatabaseReference => ref(db, `batteries/${id}`);

  // 1️⃣ Admin read/write → allow
  it("allows admin to read/write any battery", async () => {
    await login("admin@gmail.com", "Temp@123");

    const id = "BAT1";
    await set(batteryRef(id), { id, type: "Temporary", serial_no: "SN001" });

    const snap: DataSnapshot = await get(batteryRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  // 2️⃣ Inventory read/write → allow
  it("allows inventory staff to read/write batteries", async () => {
    await login("staff@gmail.com", "Temp@123");

    const id = "BAT2";
    await set(batteryRef(id), { id, type: "Final", serial_no: "SN002" });

    const snap: DataSnapshot = await get(batteryRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

//blocks operator/technician from reading/writing batteries
 it("blocks operator/technician from reading/writing batteries", async () => {
  await login("operator@gmail.com", "Temp@123"); // Firebase Auth user role = operator

  // Attempt write
  try {
    await set(batteryRef("BAT3"), { id: "BAT3", type: "Final", serial_no: "SN003" });
    throw new Error("Operator/technician should NOT be able to write batteries!");
  } catch (err: any) {
    expect(err.code || err.message).to.include("PERMISSION_DENIED");
  }

  // Attempt read
  try {
    await get(batteryRef("BAT1"));
    throw new Error("Operator/technician should NOT be able to read batteries!");
  } catch (err: any) {
    expect(err.code || err.message).to.include("PERMISSION_DENIED");
  }
});


});
*/}

/// <reference types="cypress" />
import { login } from "../support/firebase.js";
import { getDatabase, ref, set, get, DatabaseReference, DataSnapshot } from "firebase/database";

// Firebase DB instance
import { app } from "../support/firebase.js";
const db = getDatabase(app);

describe("Firebase Batteries Rules", () => {
  const batteryRef = (id: string): DatabaseReference => ref(db, `batteries/${id}`);

  // 1️⃣ Admin read/write → allow
  it("allows admin to read/write any battery", async () => {
    await login("admin@gmail.com", "Temp@123");

    const id = "BAT1";
    await set(batteryRef(id), { id, type: "Temporary", serial_no: "SN001" });

    const snap: DataSnapshot = await get(batteryRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  // 2️⃣ Inventory staff read/write → allow
  it("allows inventory staff to read/write batteries", async () => {
    await login("staff@gmail.com", "Temp@123");

    const id = "BAT2";
    await set(batteryRef(id), { id, type: "Final", serial_no: "SN002" });

    const snap: DataSnapshot = await get(batteryRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  // 3️⃣ Operator/technician read/write → deny
  it("blocks operator/technician from reading/writing batteries", async () => {
    await login("operator@gmail.com", "Temp@123"); // Firebase Auth user role = operator

    // Attempt write
    try {
      await set(batteryRef("BAT3"), { id: "BAT3", type: "Final", serial_no: "SN003" });
      throw new Error("Operator/technician should NOT be able to write batteries!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }

    // Attempt read
    try {
      await get(batteryRef("BAT1"));
      throw new Error("Operator/technician should NOT be able to read batteries!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }
  });
});
