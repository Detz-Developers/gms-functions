// cypress/e2e/reports-rules.cy.ts
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  get,
  set,
} from "firebase/database";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyB4uksA5X1fQoh9kXjN1R5_Vg66N7Muoos",
  authDomain: "genizest.firebaseapp.com",
  databaseURL: "https://genizest-default-rtdb.firebaseio.com",
  projectId: "genizest",
};

describe("RealtimeDB Rules - Reports", () => {
  let app: any;
  let db: any;
  let auth: any;

  beforeEach(() => {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    auth = getAuth(app);
  });

  afterEach(async () => {
    await signOut(auth);
  });

  const reportsRef = (path = "monthly/test-report") =>
    ref(db, `reports/${path}`);

  it("allows admin to write a report", async () => {
    await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");

    await set(reportsRef(), { generatedAt: Date.now(), tasksCompleted: 10 });
    const snap = await get(reportsRef());
    expect(snap.exists()).to.be.true;
  });

  it("allows admin to read a report", async () => {
    await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");

    const snap = await get(reportsRef());
    // if not yet created, no crash → just deny check
    expect(snap.val()).to.not.equal(null);
  });

  it("denies non-admin writing a report", async () => {
    await signInWithEmailAndPassword(auth, "operator@gmail.com", "Temp@123");

    try {
      await set(reportsRef(), { generatedAt: Date.now() });
      throw new Error("Non-admin should NOT be able to write reports!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }
  });

  it("denies non-admin reading a report", async () => {
    await signInWithEmailAndPassword(auth, "operator@gmail.com", "Temp@123");

    try {
      await get(reportsRef());
      throw new Error("Non-admin should NOT be able to read reports!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }
  });
});
