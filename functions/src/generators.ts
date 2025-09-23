import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const generatorsRef = () => admin.database().ref("generators");

// Helper: only admins can create/update
const assertAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  if (ctx.auth.token?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
};

// Auto bump updatedAt on any generator change
export const onGeneratorUpdate = db.onValueUpdated(
  { ref: "/generators/{genId}", region: REGION },
  async (event) => {
    const before = event.data.before.val() ?? {};
    const after = event.data.after.val() ?? {};

    const { updatedAt: _b, ...bRest } = before;
    const { updatedAt: _a, ...aRest } = after;

    if (JSON.stringify(bRest) === JSON.stringify(aRest)) {
      return; // only updatedAt changed
    }

    await event.data.after.ref
      .child("updatedAt")
      .set(admin.database.ServerValue.TIMESTAMP);
  }
);

// Callable: create generator
export const createGenerator = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const {
    id,
    brand,
    size,
    serial_no,
    issued_date,
    installed_date,
    status = "Active",
    shop_id,
    location,
    auto_start = false,
    warranty,
    charger_details = {}
  } = req.data || {};

  if (!id || !brand || !serial_no || !shop_id) {
    throw new HttpsError("invalid-argument", "id, brand, serial_no, shop_id required.");
  }

  const now = Date.now();

  const payload = {
    id,
    brand,
    size,
    serial_no,
    issued_date: issued_date ?? null,
    installed_date: installed_date ?? null,
    status,
    shop_id,
    location: location ?? null,
    auto_start,
    warranty: warranty ?? null,
    charger_details,
    extracted_parts: [],
    createdAt: now,
    updatedAt: now
  };

  await generatorsRef().child(id).set(payload);
  return { ok: true, id };
});

// Callable: update generator
export const updateGenerator = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { id, ...patch } = req.data || {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");

  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k !== "createdAt") updates[`generators/${id}/${k}`] = v;
  }
  updates[`generators/${id}/updatedAt`] = Date.now();

  await admin.database().ref().update(updates);
  return { ok: true };
});

// Callable: change status
export const setGeneratorStatus = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { id, status } = req.data || {};
  if (!id || !status) {
    throw new HttpsError("invalid-argument", "id + status required.");
  }

  await generatorsRef().child(id).child("status").set(status);
  await generatorsRef().child(id).child("updatedAt").set(Date.now());
  return { ok: true };
});

