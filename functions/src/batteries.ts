import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const REGION = "us-central1";
const batteriesRef = () => admin.database().ref("batteries");
const generatorsRef = () => admin.database().ref("generators");

// Helper: only admins & inventory staff
const assertInventoryOrAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = ctx.auth.token?.role;
  if (role !== "admin" && role !== "inventory") {
    throw new HttpsError("permission-denied", "Admin or Inventory only.");
  }
};

// Auto bump updatedAt on any battery change
export const onBatteryUpdate = db.onValueUpdated(
  { ref: "/batteries/{batId}", region: REGION },
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

// Callable: add battery
export const addBattery = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const {
    id,
    type,
    size,
    serial_no,
    install_date,
    generator_id,
    gate_pass
  } = req.data || {};

  if (!id || !type || !serial_no) {
    throw new HttpsError("invalid-argument", "id, type, serial_no are required.");
  }

  const now = Date.now();
  const payload = {
    id,
    type, // "Temporary" | "Final"
    size: size ?? null,
    serial_no,
    install_date: install_date ?? null,
    generator_id: generator_id ?? null,
    gate_pass: gate_pass ?? null,
    createdAt: now,
    updatedAt: now
  };

  await batteriesRef().child(id).set(payload);

  // If assigned to a generator, update generator record
  if (generator_id) {
    await generatorsRef().child(generator_id).child("battery_id").set(id);
  }

  return { ok: true, id };
});

// Callable: assign battery to generator
export const assignBattery = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const { battery_id, generator_id } = req.data || {};
  if (!battery_id || !generator_id) {
    throw new HttpsError("invalid-argument", "battery_id + generator_id required.");
  }

  // Update both records
  await batteriesRef().child(battery_id).child("generator_id").set(generator_id);
  await generatorsRef().child(generator_id).child("battery_id").set(battery_id);
  await batteriesRef().child(battery_id).child("updatedAt").set(Date.now());

  return { ok: true };
});

// Callable: replace battery (remove old, add new)
export const replaceBattery = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const { old_battery_id, new_battery_id, generator_id } = req.data || {};
  if (!old_battery_id || !new_battery_id || !generator_id) {
    throw new HttpsError("invalid-argument", "old_battery_id, new_battery_id, generator_id required.");
  }

  // Unlink old battery
  await batteriesRef().child(old_battery_id).child("generator_id").set(null);

  // Link new battery
  await batteriesRef().child(new_battery_id).child("generator_id").set(generator_id);
  await generatorsRef().child(generator_id).child("battery_id").set(new_battery_id);

  const now = Date.now();
  await batteriesRef().child(old_battery_id).child("updatedAt").set(now);
  await batteriesRef().child(new_battery_id).child("updatedAt").set(now);

  return { ok: true };
});
