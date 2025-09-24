// cypress/e2e/generator.cy.ts
import { initializeApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyB4uksA5X1fQoh9kXjN1R5_Vg66N7Muoos",
  authDomain: "genizest.firebaseapp.com",
  projectId: "genizest",
  appId: "1:728207587632:web:2f73ed4c0124d44ceaf0f5",
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, "us-central1");
const auth = getAuth(app);

describe("Generator Functions", () => {
  beforeEach(() => {
    // logout before each test
    return auth.signOut();
  });

  it("✅ should allow admin to create generator", () => {
    cy.wrap(null).then(async () => {
      // 1. login with admin test user (must have role=admin custom claim set in Firebase)
      await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");

      // 2. call function
      const fn = httpsCallable(functions, "createGenerator");
      const res: any = await fn({
        id: "gen-001",
        brand: "Honda",
        serial_no: "SN123",
        shop_id: "shop-001",
      });

      expect(res.data.ok).to.eq(true);
      expect(res.data.id).to.eq("gen-001");
    });
  });

  it("❌ should deny non-admin create generator", () => {
    cy.wrap(null).then(async () => {
      // 1. login with normal user (without admin claim)
      await signInWithEmailAndPassword(auth, "tech@gmail.com", "Temp@123");

      const fn = httpsCallable(functions, "createGenerator");
      try {
        await fn({
          id: "gen-002",
          brand: "Yamaha",
          serial_no: "SN124",
          shop_id: "shop-002",
        });
        throw new Error("Expected permission-denied but function succeeded");
      } catch (err: any) {
        expect(err.message).to.include("permission-denied");
      }
    });
  });

  it("✅ should allow admin to update generator status", () => {
    cy.wrap(null).then(async () => {
      await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");

      const fn = httpsCallable(functions, "setGeneratorStatus");
      const res: any = await fn({ id: "gen-001", status: "Inactive" });

      expect(res.data.ok).to.eq(true);
    });
  });
});
