import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) admin.initializeApp();

const ref = () => admin.database().ref("serviceLogs");
const genRef = () => admin.database().ref("generators");

const assertTechOrAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = ctx.auth.token?.role;
  if (role !== "admin" && role !== "technician") {
    throw new HttpsError("permission-denied", "Admin or Technician only.");
  }
};

const TYPES = ["Maintenance", "Repair", "Emergency Repair"] as const;
type ServiceType = (typeof TYPES)[number];

const nextId = async (): Promise<string> => {
  const snap = await ref().once("value");
  let max = 0;
  if (snap.exists()) {
    snap.forEach((c) => {
      const id: string = (c.val()?.id ?? c.key) as string;
      const m = /^SVL(\d+)$/.exec(id ?? "");
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n)) max = Math.max(max, n);
      }
      return false;
    });
  }
  return "SVL" + String(max + 1).padStart(4, "0");
};

export const onServiceLogUpdate = db.onValueUpdated(
  { ref: "/serviceLogs/{logId}", region: REGION },
  async (event) => {
    const before = event.data.before.val() ?? {};
    const after = event.data.after.val() ?? {};
    const { updatedAt: _b, ...b } = before;
    const { updatedAt: _a, ...a } = after;
    if (JSON.stringify(b) === JSON.stringify(a)) return;
    await event.data.after.ref.child("updatedAt").set(admin.database.ServerValue.TIMESTAMP);
  }
);

export const createServiceLog = onCall({ region: REGION }, async (req) => {
  assertTechOrAdmin(req);
  const {
    generator_id,
    technician_id,
    service_type,
    service_date,
    next_due_date,
    notes
  }: {
    generator_id?: string;
    technician_id?: string;
    service_type?: ServiceType;
    service_date?: number;
    next_due_date?: number | null;
    notes?: string | null;
  } = req.data ?? {};

  if (!generator_id) throw new HttpsError("invalid-argument", "generator_id is required.");
  if (!technician_id) throw new HttpsError("invalid-argument", "technician_id is required.");
  if (!service_type || !TYPES.includes(service_type)) {
    throw new HttpsError("invalid-argument", `service_type must be ${TYPES.join(" | ")}`);
  }

  const genSnap = await genRef().child(generator_id).once("value");
  if (!genSnap.exists()) throw new HttpsError("not-found", `Generator ${generator_id} not found.`);

  const id = await nextId();
  const now = Date.now();

  const payload = {
    id,
    generator_id,
    technician_id,
    service_type,
    service_date: service_date ?? now,
    next_due_date: next_due_date ?? null,
    notes: notes ?? "",
    overdue: next_due_date ? Date.now() > next_due_date : false,
    createdAt: now,
    updatedAt: now
  };

  await ref().child(id).set(payload);
  return { ok: true, id };
});

export const getServiceLog = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { id } = req.data ?? {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");
  const snap = await ref().child(id).once("value");
  if (!snap.exists()) throw new HttpsError("not-found", `Service log ${id} not found.`);
  return { ok: true, data: snap.val() };
});

export const listServiceLogs = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const {
    generator_id,
    service_type,
    date_from,
    date_to,
    limit = 100,
    cursor
  }: {
    generator_id?: string;
    service_type?: ServiceType;
    date_from?: number;
    date_to?: number;
    limit?: number;
    cursor?: string;
  } = req.data ?? {};

  const snap = await ref().once("value");
  if (!snap.exists()) return { ok: true, items: [], nextCursor: null };

  let arr: any[] = [];
  snap.forEach((c) => {
    arr.push(c.val());
    return false;
  });
  if (generator_id) arr = arr.filter((x) => x.generator_id === generator_id);
  if (service_type) arr = arr.filter((x) => x.service_type === service_type);
  if (typeof date_from === "number") arr = arr.filter((x) => (x.service_date ?? 0) >= date_from);
  if (typeof date_to === "number") arr = arr.filter((x) => (x.service_date ?? 0) < date_to);

  arr.sort((a, b) => (b.service_date ?? 0) - (a.service_date ?? 0));
  const start = cursor ? arr.findIndex((x) => String(x.id) === String(cursor)) + 1 : 0;
  const page = arr.slice(start, start + Math.max(1, Math.min(limit, 500)));
  const nextCursor = page.length && start + page.length < arr.length ? page[page.length - 1].id : null;

  return { ok: true, items: page, nextCursor };
});

export const updateServiceLog = onCall({ region: REGION }, async (req) => {
  assertTechOrAdmin(req);
  const { id, ...patch } = req.data ?? {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");

  const r = ref().child(id);
  const snap = await r.once("value");
  if (!snap.exists()) throw new HttpsError("not-found", `Service log ${id} not found.`);

  if ("id" in patch) delete (patch as any).id;
  if ("createdAt" in patch) delete (patch as any).createdAt;

  if ("service_type" in patch) {
    const t = patch.service_type as ServiceType;
    if (!TYPES.includes(t)) {
      throw new HttpsError("invalid-argument", `service_type must be ${TYPES.join(" | ")}`);
    }
  }

  const updates: Record<string, any> = { ...patch, updatedAt: Date.now() };
  if ("next_due_date" in updates) {
    updates.overdue = updates.next_due_date ? Date.now() > updates.next_due_date : false;
  }

  await r.update(updates);
  return { ok: true };
});

export const deleteServiceLog = onCall({ region: REGION }, async (req) => {
  assertTechOrAdmin(req);
  const { id } = req.data ?? {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");

  const r = ref().child(id);
  const snap = await r.once("value");
  if (!snap.exists()) throw new HttpsError("not-found", `Service log ${id} not found.`);
  await r.remove();
  return { ok: true, id };
});
