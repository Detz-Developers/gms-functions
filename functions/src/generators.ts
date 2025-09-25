import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) admin.initializeApp();

const ref = () => admin.database().ref("generators");
const ALLOWED_STATUSES = ["Active", "Under Repair", "Unusable"] as const;
type GenStatus = (typeof ALLOWED_STATUSES)[number];
const ALLOWED_LOCATIONS = ["UP", "DOWN"] as const;
type GenLocation = (typeof ALLOWED_LOCATIONS)[number];

const assertAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  if (ctx.auth.token?.role !== "admin") throw new HttpsError("permission-denied", "Admin only.");
};

const toBit = (v: any): 0 | 1 => {
  const b = typeof v === "string" ? v.trim().toLowerCase() : v;
  return (b === true || b === 1 || b === "1" || b === "true" || b === "yes" || b === "y") ? 1 : 0;
};

const normalizeLocation = (v: any): GenLocation => {
  const s = String(v ?? "").trim().toUpperCase();
  if (ALLOWED_LOCATIONS.includes(s as GenLocation)) return s as GenLocation;
  throw new HttpsError("invalid-argument", `location must be ${ALLOWED_LOCATIONS.join(" | ")}`);
};

const normalizeStatus = (v: any): GenStatus => {
  const s = String(v ?? "").trim();
  if (ALLOWED_STATUSES.includes(s as GenStatus)) return s as GenStatus;
  throw new HttpsError("invalid-argument", `status must be ${ALLOWED_STATUSES.join(" | ")}`);
};

const nextId = async (): Promise<string> => {
  const snap = await ref().once("value");
  let max = 0;
  if (snap.exists()) {
    snap.forEach((c) => {
      const id: string = (c.val()?.id ?? c.key) as string;
      const m = /^GN(\d+)$/.exec(id ?? "");
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n)) max = Math.max(max, n);
      }
      return false;
    });
  }
  return "GN" + String(max + 1).padStart(4, "0");
};

export const onGeneratorUpdate = db.onValueUpdated(
  { ref: "/generators/{genId}", region: REGION },
  async (event) => {
    const before = event.data.before.val() ?? {};
    const after = event.data.after.val() ?? {};
    const { updatedAt: _b, ...b } = before;
    const { updatedAt: _a, ...a } = after;
    if (JSON.stringify(b) === JSON.stringify(a)) return;
    await event.data.after.ref.child("updatedAt").set(admin.database.ServerValue.TIMESTAMP);
  }
);

export const createGenerator = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const {
    brand,
    size,
    serial_no,
    issued_date,
    installed_date,
    status = "Active",
    shop_id,
    location,
    hasAutoStart,
    hasBatteryCharger,
    warranty,
    extracted_parts
  } = req.data ?? {};

  if (!brand || !serial_no || !shop_id) {
    throw new HttpsError(
      "invalid-argument",
      "brand, serial_no, shop_id are required."
    );
  }

  const id = await nextId();
  const payload = {
    id,
    brand,
    size: size ?? null,
    serial_no,
    issued_date: issued_date ?? null,
    installed_date: installed_date ?? null,
    status: normalizeStatus(status),
    shop_id,
    location: normalizeLocation(location),
    hasAutoStart: toBit(hasAutoStart),
    hasBatteryCharger: toBit(hasBatteryCharger),
    warranty: warranty ?? null,
    extracted_parts: Array.isArray(extracted_parts) ? extracted_parts : [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await ref().child(id).set(payload);
  return { ok: true, id };
});

export const updateGenerator = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { id, ...patch } = req.data ?? {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");
  const r = ref().child(id);
  const snap = await r.once("value");
  if (!snap.exists()) throw new HttpsError("not-found", `Generator ${id} not found.`);

  if ("id" in patch) delete (patch as any).id;
  if ("createdAt" in patch) delete (patch as any).createdAt;

  const updates: Record<string, any> = {};
  if ("status" in patch) {
    updates.status = normalizeStatus(patch.status); delete (patch as any).status;
  }
  if ("location" in patch) {
    updates.location = normalizeLocation(patch.location); delete (patch as any).location;
  }
  if ("hasAutoStart" in patch) {
    updates.hasAutoStart = toBit(patch.hasAutoStart); delete (patch as any).hasAutoStart;
  }
  if ("hasBatteryCharger" in patch) {
    updates.hasBatteryCharger = toBit(patch.hasBatteryCharger); delete (patch as any).hasBatteryCharger;
  }
  for (const [k, v] of Object.entries(patch)) updates[k] = v;

  updates.updatedAt = Date.now();
  await r.update(updates);
  return { ok: true };
});

export const setGeneratorStatus = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { id, status } = req.data ?? {};
  if (!id || !status) throw new HttpsError("invalid-argument", "id and status required.");
  await ref().child(id).update({ status: normalizeStatus(status), updatedAt: Date.now() });
  return { ok: true };
});

export const deleteGenerator = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { id } = req.data ?? {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");
  const r = ref().child(id);
  const snap = await r.once("value");
  if (!snap.exists()) throw new HttpsError("not-found", `Generator ${id} not found.`);
  await r.remove();
  return { ok: true, id };
});
