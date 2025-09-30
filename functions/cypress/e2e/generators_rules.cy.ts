{/*}
/// <reference types="cypress" />
import { login } from "../support/firebase.js";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../support/firebase.js";

const functions = getFunctions(app);

describe("Generator Functions", () => {
  it("blocks non-admin from creating generator", () => {
    return login("operator@gmail.com", "operate@123")
      .then(() => httpsCallable(functions, "createGenerator")({
        id: "G100",
        brand: "CAT",
        serial_no: "SN100",
        shop_id: "S1"
      }))
      .then(() => {
        throw new Error("Non-admin create wenna epa");
      })
      .catch((err: any) => {
        expect(err.code).to.eq("permission-denied");
      });
  });

  it("allows admin to create generator", () => {
    return login("greenpawn777@gmail.com", "23@Ttnt4532")
      .then(() => httpsCallable(functions, "createGenerator")({
        id: "G101",
        brand: "CAT",
        serial_no: "SN101",
        shop_id: "S1"
      }))
      .then((res: any) => {
        expect(res.data.ok).to.be.true;
      });
  });
});
*/}

/// <reference types="cypress" />
import { db, login } from "../support/firebase.js";
import { ref, set, get, query, orderByChild, equalTo } from "firebase/database";

describe("Firebase Generators Rules", () => {
  const genRef = (id: string) => ref(db, `generators/${id}`);
  const gensRef = ref(db, "generators");

  // 1. Admin read/write any → allow
  it("allows admin to read/write any generator", () => {
    login("admin@gmail.com", "Temp@123")
      .then(() =>
        set(genRef("GEN1"), {
          id: "GEN1",
          brand: "Honda",
          serial_no: "SN123",
          shop_id: "SHOP1",
        })
      )
      .then(() => get(genRef("GEN1")))
      .then((snap) => {
        const data = snap.val();
        expect(data).to.exist;
        expect(data.id).to.eq("GEN1");
      })
      .catch((err) => {
        throw new Error("Admin read/write failed: " + err.message);
      });
  });

  // 2. Non-admin read with query shop_id == auth.token.shopId → allow
  it("allows non-admin to read generators from own shop", () => {
    login("operator@gmail.com", "Temp@123")
      .then(() => {
        const q = query(gensRef, orderByChild("shop_id"), equalTo("SHOP1"));
        return get(q);
      })
      .then((snap) => {
        const results: any = snap.val();
        expect(results).to.exist;
        const first = Object.values(results)[0] as any;
        expect(first.shop_id).to.eq("SHOP1");
      });
  });

  // 3. Non-admin without query → deny
  it("blocks non-admin from reading all generators", () => {
    login("operator@gmail.com", "Temp@123")
      .then(() => get(gensRef))
      .then(() => {
        throw new Error("Non-admin should not read all generators!");
      })
      .catch((err) => {
        expect(err.code).to.eq("PERMISSION_DENIED");
      });
  });

  // 4. Non-admin write → deny
  it("blocks non-admin from writing generators", () => {
    login("operator@gmail.com", "Temp@123")
      .then(() =>
        set(genRef("GEN2"), {
          id: "GEN2",
          brand: "Yamaha",
          serial_no: "SN999",
          shop_id: "SHOP2",
        })
      )
      .then(() => {
        throw new Error("Non-admin should not write generators!");
      })
      .catch((err) => {
        expect(err.code).to.eq("PERMISSION_DENIED");
      });
  });
});
