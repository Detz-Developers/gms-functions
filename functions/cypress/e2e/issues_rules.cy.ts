/// <reference types="cypress" />
import { db, login } from "../support/firebase.js";
import { ref, set, get, DatabaseReference, DataSnapshot } from "firebase/database";
import { signOut } from "firebase/auth";
import { auth } from "../support/firebase.js";

describe("Firebase Issues Rules", () => {
  const issueRef = (id: string): DatabaseReference => ref(db, `issues/${id}`);

  // ✅ Admin read/write → allow
  it("allows admin to read/write any issue", async () => {
    await login("admin@gmail.com", "Temp@123");

    const id = "ISS1";
    await set(issueRef(id), {
      id,
      equipment_type: "generator",
      equipment_id: "GEN1",
      description: "Overheating",
      createdBy: "user1",
      createdByRole: "operator"
    });

    const snap: DataSnapshot = await get(issueRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  // ✅ Technician read issue if createdByRole = "operator" → allow
  it("allows technician to read issue created by operator", async () => {
    await login("tech@gmail.com", "Temp@123");

    const id = "ISS2";
    await set(issueRef(id), {
      id,
      equipment_type: "battery",
      equipment_id: "BAT1",
      description: "Low charge",
      createdBy: "operatorUser",
      createdByRole: "operator"
    });

    const snap: DataSnapshot = await get(issueRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  // Owner (createdBy = auth.uid) read own → allow
it("allows owner to read their own issue", async () => {
  const userCred = await login("tech@gmail.com", "Temp@123");
  const uid = userCred.user.uid;

  const id = "ISS3";
  await set(issueRef(id), {
    id,
    equipment_type: "charger",
    equipment_id: "CHG1",
    description: "Faulty cable",
    createdBy: uid,
    createdByRole: "technician"
  });

  const snap: DataSnapshot = await get(issueRef(id));
  expect(snap.exists()).to.be.true;
  expect(snap.val().createdBy).to.eq(uid);
});

  //  Others read → deny
  it("blocks other users from reading issues they don't own", async () => {
    await login("staff@gmail.com", "Temp@123");

    try {
      await get(issueRef("ISS3"));
      throw new Error("Other users should NOT be able to read issues!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }
  });

  //  Any authenticated user write → allow
  it("allows any authenticated user to write issues", async () => {
    await login("tech@gmail.com", "Temp@123");

    const id = "ISS4";
    await set(issueRef(id), {
      id,
      equipment_type: "generator",
      equipment_id: "GEN2",
      description: "Noise detected",
      createdBy: "user",
      createdByRole: "technician"
    });

    const snap: DataSnapshot = await get(issueRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  //  Unauthenticated write → deny
it("blocks unauthenticated users from writing issues", async () => {
  await signOut(auth); // ✅ logout

  try {
    await set(issueRef("ISS5"), {
      id: "ISS5",
      equipment_type: "battery",
      equipment_id: "BAT2",
      description: "Leak detected",
      createdBy: "unknown"
    });
    throw new Error("Unauthenticated user should NOT be able to write issues!");
  } catch (err: any) {
    expect(err.code || err.message).to.include("PERMISSION_DENIED");
  }
});
});
