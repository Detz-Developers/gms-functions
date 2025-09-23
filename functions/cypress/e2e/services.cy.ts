/// <reference types="cypress" />
import { db, login } from "../support/firebase.js";
import { ref, set, get, DatabaseReference, DataSnapshot } from "firebase/database";

describe("Firebase Service Logs Rules", () => {
  const logRef = (id: string): DatabaseReference => ref(db, `serviceLogs/${id}`);

  // 1️⃣ Admin read/write → allow
  it("allows admin to read/write any service log", async () => {
    await login("admin@gmail.com", "Temp@123");

    const id = "LOG1";
    await set(logRef(id), { id, generator_id: "GEN1", technician_id: "tech1", service_type: "Inspection" });

    const snap: DataSnapshot = await get(logRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  // 2️⃣ Technician read/write → allow
  it("allows technician to read/write service logs", async () => {
    await login("tech@gmail.com", "Temp@123"); // role = technician

    const id = "LOG2";
    await set(logRef(id), { id, generator_id: "GEN2", technician_id: "tech1", service_type: "Maintenance" });

    const snap: DataSnapshot = await get(logRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  // 3️⃣ Other users → deny
  it("blocks other users from reading/writing service logs", async () => {
    await login("staff@gmail.com", "Temp@123"); // role = other

    // Attempt write
    try {
      await set(logRef("LOG3"), { id: "LOG3", generator_id: "GEN3", technician_id: "tech2", service_type: "Repair" });
      throw new Error("Other users should NOT be able to write service logs!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }

    // Attempt read
    try {
      await get(logRef("LOG1"));
      throw new Error("Other users should NOT be able to read service logs!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }
  });
});
