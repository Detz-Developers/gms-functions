/// <reference types="cypress" />
import { db, login } from "../support/firebase.js";
import { ref, set, get, DatabaseReference, DataSnapshot } from "firebase/database";

describe("Firebase Tasks Rules", () => {
  const taskRef = (id: string): DatabaseReference => ref(db, `tasks/${id}`);

  // 1️⃣ Admin read/write → allow
  it("allows admin to read/write any task", async () => {
    await login("admin@gmail.com", "Temp@123");

    const id = "TASK1";
    await set(taskRef(id), { id, description: "Check generator", assigned_to: "user1" });

    const snap: DataSnapshot = await get(taskRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  // 2️⃣ Assigned user read own task → allow
  it("allows assigned user to read own task", async () => {
    await login("operator@gmail.com", "Temp@123"); // uid == user1
    const snap: DataSnapshot = await get(taskRef("TASK1"));
    expect(snap.exists()).to.be.true;
    expect(snap.val().assigned_to).to.eq("user1");
  });

  // 3️⃣ Other users read → deny
  it("blocks other users from reading tasks not assigned to them", async () => {
    await login("staff@gmail.com", "Temp@123"); // uid != user1
    try {
      await get(taskRef("TASK1"));
      throw new Error("Other user should NOT be able to read this task!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }
  });

  // 4️⃣ Operator write → allow
  it("allows operator to create a task", async () => {
    await login("operator@gmail.com", "Temp@123");

    const id = "TASK2";
    await set(taskRef(id), { id, description: "Inspect battery", assigned_to: "user2" });

    const snap: DataSnapshot = await get(taskRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  // 5️⃣ Inventory/technician write → deny
  it("blocks inventory/technician from creating/updating tasks", async () => {
    await login("tech@gmail.com", "Temp@123"); // role = technician

    try {
      await set(taskRef("TASK3"), { id: "TASK3", description: "Test", assigned_to: "user3" });
      throw new Error("Inventory/technician should NOT be able to write tasks!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }
  });
});
