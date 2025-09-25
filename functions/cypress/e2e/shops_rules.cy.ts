/// <reference types="cypress" />
import { db, login } from "../support/firebase.js";
import { ref, set, get, query, orderByChild, equalTo, DatabaseReference, DataSnapshot } from "firebase/database";

describe("Firebase Invoices Rules", () => {
  const invoiceRef = (id: string): DatabaseReference => ref(db, `invoices/${id}`);

  // 1. Admin read/write → allow
  it("allows admin to read/write any invoice", async () => {
    await login("admin@gmail.com", "Temp@123");
    
    const id = "INV1";
    await set(invoiceRef(id), { id, shop_id: "SHOP1", amount: 100 });
    
    const snap: DataSnapshot = await get(invoiceRef(id));
    expect(snap.exists()).to.be.true;
    expect(snap.val().id).to.eq(id);
  });

  // 2. Shop owner (shop_id == auth.token.shopId) read own → allow
  it("allows shop owner to read own invoices", async () => {
  await login("operator@gmail.com", "Temp@123"); // shop_id == SHOP1

  const q = query(ref(db, "invoices"), orderByChild("shop_id"), equalTo("SHOP1"));
  const snap: DataSnapshot = await get(q);

  expect(snap.exists()).to.be.true;

  // Type assertion to fix 'unknown' type
  const snapVal = snap.val() as Record<string, { shop_id: string; [key: string]: any }>;
  const firstInvoice = Object.values(snapVal)[0];

  expect(firstInvoice.shop_id).to.eq("SHOP1");
});

  // 3. Others read → deny
  it("blocks other non-admins from reading invoices of other shops", async () => {
    await login("tech@gmail.com", "Temp@123"); // shop_id == SHOP2
    
    try {
      await get(invoiceRef("INV1"));
      throw new Error("Should not read other shop's invoice!");
    } catch (err: any) {
      expect(err.code || err.message).to.include("PERMISSION_DENIED");
    }
  });

  // 4. Non-admin write → deny
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
