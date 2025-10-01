

/// <reference types="cypress" />
import { db, login } from "../support/firebase.js";
import { ref, set, get } from "firebase/database";

describe("Firebase Users Rules - specific cases", () => {
  const userRef = (uid: string) => ref(db, `users/${uid}`);

  // 1. Same user read own data
  it("allows same user to read own data", () => {
    login("operator@gmail.com", "Temp@123")
      .then(() => get(userRef("operatorUID")))
      .then((snapshot) => {
        const data = snapshot.val();
        expect(data).to.exist;
        expect(data.id).to.eq("operatorUID");
      });
  });

  // 2. Other user read → deny
  it("blocks user from reading other user's data", () => {
    login("operator@gmail.com", "Temp@123")
      .then(() => get(userRef("adminUID")))
      .then(() => {
        throw new Error("User should not read other user's data!");
      })
      .catch((err: any) => {
        expect(err.code).to.eq("PERMISSION_DENIED");
      });
  });

  // 3. Admin read/write any user → allow
  it("allows admin to read/write any user", () => {
    login("admin@gmail.com", "Temp@123")
      .then(() => get(userRef("operatorUID")))
      .then((snapshot) => {
        const data = snapshot.val();
        expect(data).to.exist;
      })
      .then(() =>
        set(userRef("newTestUID"), {
          email: "testuser@example.com",
          name: "Test User",
          role: "operator",
        })
      )
      .then(() => cy.log("Admin read/write success"))
      .catch((err: any) => {
        throw new Error("Admin read/write failed: " + err.message);
      });
  });

  // 4. Non-admin write → deny
  it("blocks non-admin from writing user data", () => {
    login("operator@gmail.com", "Temp@123")
      .then(() =>
        set(userRef("newTestUID2"), {
          email: "failuser@example.com",
          name: "Fail User",
          role: "operator",
        })
      )
      .then(() => {
        throw new Error("Non-admin should not write user data!");
      })
      .catch((err: any) => {
        expect(err.code).to.eq("PERMISSION_DENIED");
      });
  });
});
