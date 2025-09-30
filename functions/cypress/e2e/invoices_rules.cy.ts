{/*
/// <reference types="cypress" />
import { db, login } from "../support/firebase.js";
import { ref, set, get } from "firebase/database";

describe("Invoices Rules", () => {
  const invoiceRef = (id: string) => ref(db, `invoices/${id}`);

  it("blocks non-admin from writing invoice", () => {
    return login("inventory@gmail.com", "invent123")
      .then(() => set(invoiceRef("INV123"), { shop_id: "S1", status: "Pending" }))
      .then(() => { throw new Error("Non-admin write wenna epa"); })
      .catch((err: any) => {
        expect(err.code).to.eq("PERMISSION_DENIED");
      });
  });

  it("allows admin to write invoice", () => {
    return login("admin@gmail.com", "admin123")
      .then(() => set(invoiceRef("INV124"), { shop_id: "S1", status: "Paid" }))
      .then(() => {
        cy.log("✅ Admin walata invoice write allow wenawa");
      });
  });
});
*/}
/// <reference types="cypress" />
import { db, login } from "../support/firebase.js";
import {
  ref,
  set,
  get,
  query,
  orderByChild,
  equalTo,
  DataSnapshot,
} from "firebase/database";

describe("Firebase Invoices Rules", () => {
  const invoiceRef = (id: string) => ref(db, `invoices/${id}`);

  it("allows admin to read/write any invoice", async () => {
    await login("admin@gmail.com", "Temp@123");
    const id = "INV1";

    await set(invoiceRef(id), { id, shop_id: "SHOP1", amount: 100 });

    const snap: DataSnapshot = await get(invoiceRef(id));
    expect(snap.exists()).to.be.true;
    const data = snap.val() as any;
    expect(data.id).to.eq(id);
  });

  it("allows shop owner to read own invoices", async () => {
    await login("operator@gmail.com", "Temp@123"); // operator shop_id == SHOP1

    const q = query(ref(db, "invoices"), orderByChild("shop_id"), equalTo("SHOP1"));
    const snap: DataSnapshot = await get(q);

    expect(snap.exists()).to.be.true;
    const values = Object.values(snap.val() as Record<string, any>);
    expect(values[0].shop_id).to.eq("SHOP1");
  });

  it("blocks other non-admins from reading invoices of other shops", async () => {
    await login("operator@gmail.com", "Temp@123"); // shop_id == SHOP2

    try {
      await get(invoiceRef("INV1"));
      throw new Error("Should not read other shop's invoice!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }
  });

  it("blocks non-admins from writing invoices", async () => {
    await login("operator@gmail.com", "Temp@123"); // not admin

    try {
      await set(invoiceRef("INV2"), { id: "INV2", shop_id: "SHOP1", amount: 50 });
      throw new Error("Should not allow non-admin writes!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }
  });
});
