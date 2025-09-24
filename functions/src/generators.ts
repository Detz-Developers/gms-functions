// functions/src/generators.ts
import { onCall } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";

// Make sure admin is initialized once in your project entrypoint.
// If not, uncomment below:
// if (!admin.apps.length) admin.initializeApp();

const rtdb = () => admin.database();
const GENERATORS_REF = "/generators";

// ────────────────────────────────────────────────────────────────
// Types & constants
// ────────────────────────────────────────────────────────────────

type Status = "ACTIVE" | "REPAIR" | "UNUSABLE";
type Location = "UP" | "DOWN";

const ALLOWED_STATUS: Status[] = ["ACTIVE", "REPAIR", "UNUSABLE"];
const ALLOWED_LOCATION: Location[] = ["UP", "DOWN"];

export interface Generator {
  serialNumber: string; // primary key (node key)
  brand?: string;
  model?: string;
  sizeKw?: number; // capacity in kW
  shopId?: string;
  status: Status; // ACTIVE | REPAIR | UNUSABLE
  location: Location; // UP | DOWN
  hasBatteryCharger?: boolean;
  hasAutoStart?: boolean;
  issuedDate?: number | null; // ms epoch
  installedDate?: number | null; // ms epoch
  warrantyExpiryDate?: number | null; // ms epoch
  createdAt?: number; // server timestamp
  updatedAt?: number; // server timestamp
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function isAdmin(ctx: any): boolean {
  const token = ctx?.auth?.token;
  // supports either { admin: true } or { role: "admin" }
  return token?.admin === true || token?.role === "admin";
}

function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    const err: any = new Error(message);
    err.code = "invalid-argument";
    throw err;
  }
}

function validateStatus(status?: any): asserts status is Status {
  if (status === undefined) return;
  assert(
    ALLOWED_STATUS.includes(status),
    `Invalid status. Allowed: ${ALLOWED_STATUS.join(", ")}`
  );
}

function validateLocation(location?: any): asserts location is Location {
  if (location === undefined) return;
  assert(
    ALLOWED_LOCATION.includes(location),
    `Invalid location. Allowed: ${ALLOWED_LOCATION.join(", ")}`
  );
}

const DATE_FIELDS = ["issuedDate", "installedDate", "warrantyExpiryDate"] as const;

function coerceDate(val: any): number | null | undefined {
  if (val === undefined) return undefined;
  if (val === null || val === "") return null;
  // accept number-like strings or numbers (epoch ms)
  const n = typeof val === "string" ? Number(val) : val;
  assert(!Number.isNaN(n) && Number.isFinite(n), "Date fields must be ms epoch number (or null).");
  return n;
}

function normalizeDates<T extends Record<string, any>>(obj: T): T {
  const copy: any = { ...obj };
  DATE_FIELDS.forEach((k) => {
    if (k in copy) copy[k] = coerceDate(copy[k]);
  });
  return copy;
}

function sanitizeBoolean(val: any): boolean | undefined {
  if (val === undefined) return undefined;
  if (typeof val === "boolean") return val;
  if (val === "true" || val === "1") return true;
  if (val === "false" || val === "0") return false;
  assert(false, "Boolean fields must be true/false.");
}

function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: any = {};
  Object.keys(obj).forEach((k) => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

/**
 * Shallow compare objects ignoring createdAt/updatedAt.
 */
function isOnlyMetaChanged(before: any, after: any): boolean {
  const ignore = new Set(["createdAt", "updatedAt"]);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (ignore.has(k)) continue;
    const a = before?.[k];
    const b = after?.[k];
    const bothObjects = typeof a === "object" && typeof b === "object";
    if (bothObjects) {
      // shallow compare only
      if (JSON.stringify(a) !== JSON.stringify(b)) return false;
    } else if (a !== b) {
      return false;
    }
  }
  return true;
}

// ────────────────────────────────────────────────────────────────
/**
 * RTDB Trigger:
 * - Ensure createdAt is set on first write
 * - Always bump updatedAt on meaningful changes
 * - Avoid infinite loops by skipping if only meta changed
 */
export const onGeneratorUpdate = db.onValueWritten(
  { ref: `${GENERATORS_REF}/{serialNumber}` },
  async (event) => {
    const before = event.data?.before?.val() ?? null;
    const after = event.data?.after?.val() ?? null;

    // Deleted
    if (after === null) return;

    const updates: Record<string, any> = {};

    // Set createdAt once
    if (!after.createdAt) {
      updates["createdAt"] = admin.database.ServerValue.TIMESTAMP;
    }

    // If only meta changed (createdAt/updatedAt), do nothing further
    if (isOnlyMetaChanged(before, after)) {
      // If we set createdAt above, we still need to write it
      if (Object.keys(updates).length > 0) {
        updates["updatedAt"] = admin.database.ServerValue.TIMESTAMP;
        await event.data.after.ref.update(updates);
      }
      return;
    }

    // Otherwise, bump updatedAt on meaningful changes
    updates["updatedAt"] = admin.database.ServerValue.TIMESTAMP;

    await event.data.after.ref.update(updates);
  }
);

// ────────────────────────────────────────────────────────────────
// Callables
// ────────────────────────────────────────────────────────────────

/**
 * createGenerator (admin-only)
 * Input: {
 *   serialNumber: string,  // node key (required)
 *   brand?, model?, sizeKw?, shopId?,
 *   status,                // ACTIVE | REPAIR | UNUSABLE
 *   location,              // UP | DOWN
 *   hasBatteryCharger?, hasAutoStart?,
 *   issuedDate?, installedDate?, warrantyExpiryDate?
 * }
 */
export const createGenerator = onCall(async (req) => {
  if (!isAdmin(req)) {
    const err: any = new Error("Permission denied. Admins only.");
    err.code = "permission-denied";
    throw err;
  }

  const payload = req.data ?? {};
  const serialNumber = (payload.serialNumber ?? "").trim();
  assert(serialNumber, "serialNumber is required and must be a non-empty string.");

  validateStatus(payload.status);
  validateLocation(payload.location);

  const data: Partial<Generator> = {
    serialNumber,
    brand: payload.brand?.trim(),
    model: payload.model?.trim(),
    sizeKw: payload.sizeKw !== undefined ? Number(payload.sizeKw) : undefined,
    shopId: payload.shopId?.trim(),
    status: payload.status,
    location: payload.location,
    hasBatteryCharger: sanitizeBoolean(payload.hasBatteryCharger),
    hasAutoStart: sanitizeBoolean(payload.hasAutoStart),
    issuedDate: payload.issuedDate,
    installedDate: payload.installedDate,
    warrantyExpiryDate: payload.warrantyExpiryDate
  };

  const normalized = normalizeDates(stripUndefined(data));

  // Ensure the node does not already exist
  const ref = rtdb().ref(`${GENERATORS_REF}/${serialNumber}`);
  const snap = await ref.get();
  assert(!snap.exists(), `Generator with serialNumber '${serialNumber}' already exists.`);

  // Write (createdAt/updatedAt handled by trigger)
  await ref.set(normalized);

  return { ok: true, serialNumber };
});

/**
 * updateGenerator (admin-only)
 * Input: {
 *   serialNumber: string, // required
 *   ...patch              // any writable fields
 * }
 */
export const updateGenerator = onCall(async (req) => {
  if (!isAdmin(req)) {
    const err: any = new Error("Permission denied. Admins only.");
    err.code = "permission-denied";
    throw err;
  }

  const payload = req.data ?? {};
  const serialNumber = (payload.serialNumber ?? "").trim();
  assert(serialNumber, "serialNumber is required.");

  // Make a copy and remove serialNumber from patch
  const { serialNumber: _omit, createdAt: _c, updatedAt: _u, ...patch } = payload;

  if (patch.status !== undefined) validateStatus(patch.status);
  if (patch.location !== undefined) validateLocation(patch.location);
  if (patch.hasBatteryCharger !== undefined) patch.hasBatteryCharger = sanitizeBoolean(patch.hasBatteryCharger);
  if (patch.hasAutoStart !== undefined) patch.hasAutoStart = sanitizeBoolean(patch.hasAutoStart);

  const normalized = normalizeDates(stripUndefined(patch));

  const ref = rtdb().ref(`${GENERATORS_REF}/${serialNumber}`);
  const snap = await ref.get();
  assert(snap.exists(), `Generator '${serialNumber}' not found.`);

  await ref.update(normalized); // updatedAt bumped by trigger

  return { ok: true };
});

/**
 * setGeneratorStatus (admin-only)
 * Input: { serialNumber: string, status: Status }
 */
export const setGeneratorStatus = onCall(async (req) => {
  if (!isAdmin(req)) {
    const err: any = new Error("Permission denied. Admins only.");
    err.code = "permission-denied";
    throw err;
  }

  const serialNumber = (req.data?.serialNumber ?? "").trim();
  const status = req.data?.status;
  assert(serialNumber, "serialNumber is required.");
  validateStatus(status);

  const ref = rtdb().ref(`${GENERATORS_REF}/${serialNumber}`);
  const snap = await ref.get();
  assert(snap.exists(), `Generator '${serialNumber}' not found.`);

  await ref.update({ status }); // updatedAt bumped by trigger
  return { ok: true };
});

/**
 * listGenerators (read)
 * Input (optional): { limit?: number, status?: Status, location?: Location, shopId?: string }
 */
export const listGenerators = onCall(async (req) => {
  // If you need to restrict read access, add a role check here
  const { limit, status, location, shopId } = req.data ?? {};

  if (status !== undefined) validateStatus(status);
  if (location !== undefined) validateLocation(location);

  const snap = await rtdb().ref(GENERATORS_REF).get();
  const val = snap.val() || {};
  let items: Generator[] = Object.values(val);

  if (status) items = items.filter((g) => g.status === status);
  if (location) items = items.filter((g) => g.location === location);
  if (shopId) items = items.filter((g) => g.shopId === shopId);

  const lim = typeof limit === "number" && limit > 0 ? limit : undefined;
  if (lim) items = items.slice(0, lim);

  // Sort newest updated first, fallback to createdAt, else name
  items.sort((a, b) => {
    const au = a.updatedAt ?? a.createdAt ?? 0;
    const bu = b.updatedAt ?? b.createdAt ?? 0;
    return bu - au || String(a.serialNumber).localeCompare(String(b.serialNumber));
  });

  return { ok: true, items };
});

/**
 * getGenerator (read)
 * Input: { serialNumber: string }
 */
export const getGenerator = onCall(async (req) => {
  const serialNumber = (req.data?.serialNumber ?? "").trim();
  assert(serialNumber, "serialNumber is required.");

  const snap = await rtdb().ref(`${GENERATORS_REF}/${serialNumber}`).get();
  assert(snap.exists(), `Generator '${serialNumber}' not found.`);
  return { ok: true, item: snap.val() as Generator };
});

/**
 * deleteGenerator (admin-only)
 * Input: { serialNumber: string }
 */
export const deleteGenerator = onCall(async (req) => {
  if (!isAdmin(req)) {
    const err: any = new Error("Permission denied. Admins only.");
    err.code = "permission-denied";
    throw err;
  }

  const serialNumber = (req.data?.serialNumber ?? "").trim();
  assert(serialNumber, "serialNumber is required.");

  const ref = rtdb().ref(`${GENERATORS_REF}/${serialNumber}`);
  const snap = await ref.get();
  assert(snap.exists(), `Generator '${serialNumber}' not found.`);

  await ref.remove();
  return { ok: true };
});
