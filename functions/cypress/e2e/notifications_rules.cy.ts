import { auth, db } from "../support/firebase.js";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { set, get, ref, remove } from "firebase/database";

const notifRef = (uid: string, id: string) => ref(db, `notifications/${uid}/${id}`);

describe("RealtimeDB Rules - Notifications", () => {
  const USER_UID = "user-uid-123";
  const OTHER_UID = "other-uid-999";
  const NOTIF_ID = "notif1";

  beforeEach(async () => {
    await signOut(auth);
  });

  //  User read/write own → allow
  it("allows user to write & read their own notifications", async () => {
    const userCred = await signInWithEmailAndPassword(auth, "operator@gmail.com", "Temp@123");
    const uid = userCred.user.uid;

    const testNotif = {
      id: NOTIF_ID,
      title: "Test",
      body: "Body",
      read: false,
      createdAt: Date.now(),
    };

    // Write
    await set(notifRef(uid, NOTIF_ID), testNotif);

    // Read
    const snap = await get(notifRef(uid, NOTIF_ID));
    expect(snap.exists()).to.be.true;
    expect(snap.val().title).to.eq("Test");
  });

  //  Admin write → allow
  it("allows admin to write a notification for another user", async () => {
    const adminCred = await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
    const role = (await adminCred.user.getIdTokenResult()).claims.role;
    expect(role).to.eq("admin");

    const notif = {
      id: "admin-notif",
      title: "Admin notice",
      body: "Check system",
      read: false,
      createdAt: Date.now(),
    };

    await set(notifRef(USER_UID, notif.id), notif);

    const snap = await get(notifRef(USER_UID, notif.id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().title).to.eq("Admin notice");
  });

  //  Other users read/write → deny
  it("denies reading another user’s notifications", async () => {
  const userCred = await signInWithEmailAndPassword(auth, "tech@gmail.com", "Temp@123");
  const uid = userCred.user.uid; // ✅ real uid

  // pick another fake UID that isn’t this user
  const OTHER_UID = "someone-else-uid";

  try {
    await get(notifRef(OTHER_UID, NOTIF_ID));
    throw new Error("Should NOT be able to read other users’ notifications!");
  } catch (err: any) {
    expect(err.code || err.message).to.include("PERMISSION_DENIED");
  }
});

it("denies writing to another user’s notifications", async () => {
  const userCred = await signInWithEmailAndPassword(auth, "staff@gmail.com", "Temp@123");
  const uid = userCred.user.uid; // ✅ actual UID

  const OTHER_UID = "someone-else-uid";

  try {
    await set(notifRef(OTHER_UID, "hack"), {
      id: "hack",
      title: "Hacked",
      read: false,
    });
    throw new Error("Should NOT be able to write to other users’ notifications!");
  } catch (err: any) {
    expect(err.code || err.message).to.include("PERMISSION_DENIED");
  }
});

});
