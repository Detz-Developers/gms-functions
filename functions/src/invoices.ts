import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const invoicesRef = () => admin.database().ref("invoices");

// Helpers
const assertAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  if (ctx.auth.token?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
};

// Auto bump updatedAt
export const onInvoiceUpdate = db.onValueUpdated(
  { ref: "/invoices/{invoiceId}", region: REGION },
  async (event) => {
    const before = event.data.before.val() ?? {};
    const after = event.data.after.val() ?? {};

    const { updatedAt: _b, ...bRest } = before;
    const { updatedAt: _a, ...aRest } = after;

    if (JSON.stringify(bRest) === JSON.stringify(aRest)) return;

    await event.data.after.ref
      .child("updatedAt")
      .set(admin.database.ServerValue.TIMESTAMP);
  }
);

// Callable: create invoice
export const createInvoice = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { id, shop_id, date, line_items = [], due_date } = req.data || {};
  if (!id || !shop_id) {
    throw new HttpsError("invalid-argument", "id + shop_id required.");
  }

  // Compute total
  let amount = 0;
  for (const item of line_items) {
    if (typeof item.amount === "number") amount += item.amount;
  }

  const now = Date.now();
  const payload = {
    id,
    shop_id,
    date: date ?? now,
    line_items,
    amount,
    status: "Pending",
    due_date: due_date ?? null,
    createdAt: now,
    updatedAt: now
  };

  await invoicesRef().child(id).set(payload);
  return { ok: true, id, amount };
});

// Callable: mark as paid
export const markInvoicePaid = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { id } = req.data || {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");

  await invoicesRef().child(id).child("status").set("Paid");
  await invoicesRef().child(id).child("updatedAt").set(Date.now());
  return { ok: true };
});

