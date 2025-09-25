// functions/src/generators.ts
import { onCall } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";

const rtdb = () => admin.database();
const GENERATORS_REF = "/generators";
const GENERATOR_COUNTER_REF = "/meta/generators/nextId";

// Types & constants

type Status = "ACTIVE" | "REPAIR" | "UNUSABLE";
type Location = "UP" | "DOWN";

const ALLOWED_STATUS: Status[] = ["ACTIVE", "REPAIR", "UNUSABLE"];
const ALLOWED_LOCATION: Location[] = ["UP", "DOWN"];

export interface Generator {
  id: string; // primary key, e.g. G00001
  serialNumber?: string;
  brand?: string;
  sizeKw?: number;
  shopId?: string;
  status: Status;
  location: Location;
  hasBatteryCharger?: boolean;
  hasAutoStart?: boolean;
  issuedDate?: number | null;
  installedDate?: number | null;
  warrantyExpiryDate?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

// Helpers

function isAdmin(ctx: any): boolean {
  const token = ctx?.auth?.token;
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
  assert(ALLOWED_STATUS.includes(status), `Invalid status. Allowed: ${ALLOWED_STATUS.join(", ")}`);
}

function validateLocation(location?: any): asserts location is Location {
  if (location === undefined) return;
  assert(ALLOWED_LOCATION.includes(location), `Invalid location. Allowed: ${ALLOWED_LOCATION.join(", ")}`);
}

const DATE_FIELDS = ["issuedDate", "installedDate", "warrantyExpiryDate"] as const;

function coerceDate(val: any): number | null | undefined {
  if (val === undefined) return undefined;
  if (val === null || val === "") return null;
  const n = typeof val === "string" ? Number(val) : val;
  assert(!Number.isNaN(n) && Number.isFinite(n), "Date fields must be ms epoch (or null).");
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

function formatGeneratorId(n: number): string {
  return `G${String(n).padStart(5, "0")}`;
}

async function allocateGeneratorId(): Promise<string> {
  const ref = rtdb().ref(GENERATOR_COUNTER_REF);
  const res = await ref.transaction((cur) => (typeof cur === "number" ? cur + 1 : 1));
  const n = Number(res.snapshot?.val() ?? 1);
  return formatGeneratorId(n);
}

// RTDB Trigger

export const onGeneratorUpdate = db.onValueWritten(
  { ref: `${GENERATORS_REF}/{id}` },
  async (event) => {
    const after = event.data?.after?.val() ?? null;
    if (after === null) return;

    const updates: Record<string, any> = {};
    if (!after.createdAt) updates["createdAt"] = admin.database.ServerValue.TIMESTAMP;
    updates["updatedAt"] = admin.database.ServerValue.TIMESTAMP;

    await event.data.after.ref.update(updates);
  }
);

// Callables

export const createGenerator = onCall(async (req) => {
  if (!isAdmin(req)) {
    const err: any = new Error("Permission denied.");
    err.code = "permission-denied";
    throw err;
  }

  const payload = req.data ?? {};
  validateStatus(payload.status);
  validateLocation(payload.location);

  const id = await allocateGeneratorId();

  const data: Partial<Generator> = {
    id,
    serialNumber: payload.serialNumber?.trim(),
    brand: payload.brand?.trim(),
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
  await rtdb().ref(`${GENERATORS_REF}/${id}`).set(normalized);

  return { ok: true, id };
});

export const updateGenerator = onCall(async (req) => {
  if (!isAdmin(req)) {
    const err: any = new Error("Permission denied.");
    err.code = "permission-denied";
    throw err;
  }

  const payload = req.data ?? {};
  const id = (payload.id ?? "").trim();
  assert(id, "id is required.");

  const { id: _id, createdAt: _c, updatedAt: _u, ...patch } = payload;

  if (patch.status !== undefined) validateStatus(patch.status);
  if (patch.location !== undefined) validateLocation(patch.location);
  if (patch.hasBatteryCharger !== undefined) patch.hasBatteryCharger = sanitizeBoolean(patch.hasBatteryCharger);
  if (patch.hasAutoStart !== undefined) patch.hasAutoStart = sanitizeBoolean(patch.hasAutoStart);

  const normalized = normalizeDates(stripUndefined(patch));

  const ref = rtdb().ref(`${GENERATORS_REF}/${id}`);
  const snap = await ref.get();
  assert(snap.exists(), `Generator '${id}' not found.`);

  await ref.update(normalized);
  return { ok: true };
});

export const setGeneratorStatus = onCall(async (req) => {
  if (!isAdmin(req)) {
    const err: any = new Error("Permission denied.");
    err.code = "permission-denied";
    throw err;
  }

  const id = (req.data?.id ?? "").trim();
  const status = req.data?.status;
  assert(id, "id is required.");
  validateStatus(status);

  const ref = rtdb().ref(`${GENERATORS_REF}/${id}`);
  const snap = await ref.get();
  assert(snap.exists(), `Generator '${id}' not found.`);

  await ref.update({ status });
  return { ok: true };
});

export const listGenerators = onCall(async (req) => {
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

  items.sort((a, b) => {
    const au = a.updatedAt ?? a.createdAt ?? 0;
    const bu = b.updatedAt ?? b.createdAt ?? 0;
    return bu - au || String(a.id).localeCompare(String(b.id));
  });

  return { ok: true, items };
});

export const getGenerator = onCall(async (req) => {
  const id = (req.data?.id ?? "").trim();
  assert(id, "id is required.");

  const snap = await rtdb().ref(`${GENERATORS_REF}/${id}`).get();
  assert(snap.exists(), `Generator '${id}' not found.`);
  return { ok: true, item: snap.val() as Generator };
});

export const deleteGenerator = onCall(async (req) => {
  if (!isAdmin(req)) {
    const err: any = new Error("Permission denied.");
    err.code = "permission-denied";
    throw err;
  }

  const id = (req.data?.id ?? "").trim();
  assert(id, "id is required.");

  const ref = rtdb().ref(`${GENERATORS_REF}/${id}`);
  const snap = await ref.get();
  assert(snap.exists(), `Generator '${id}' not found.`);

  await ref.remove();
  return { ok: true };
});
