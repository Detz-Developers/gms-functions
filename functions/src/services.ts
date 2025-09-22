import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const REGION = "us-central1";
const serviceLogsRef = () => admin.database().ref("serviceLogs");
const generatorsRef = () => admin.database().ref("generators");

// Helpers
const assertTechnicianOrAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = ctx.auth.token?.role;
  if (role !== "admin" && role !== "technician") {
    throw new HttpsError("permission-denied", "Admin/Technician only.");
  }
};

// Auto bump updatedAt on service log changes
export const onServiceLogUpdate = db.onValueUpdated(
  { ref: "/serviceLogs/{logId}", region: REGION },
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

// Callable: log a service
export const logService = onCall({ region: REGION }, async (req) => {
  assertTechnicianOrAdmin(req);
  const {
    id,
    generator_id,
    technician_id,
    service_type,
    service_date,
    next_due_date,
    notes
  } = req.data || {};

  if (!id || !generator_id || !technician_id || !service_type) {
    throw new HttpsError("invalid-argument", "id, generator_id, technician_id, service_type required.");
  }

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
    updatedAt: now,
  };

  await serviceLogsRef().child(id).set(payload);

  // Optional: update generator's last_service_date
  await generatorsRef().child(generator_id).child("last_service_date").set(service_date ?? now);

  return { ok: true, id };
});

// Callable: mark overdue services (Admin/Technician)
export const markOverdueServices = onCall({ region: REGION }, async (req) => {
  assertTechnicianOrAdmin(req);

  const snap = await serviceLogsRef().get();
  if (!snap.exists()) return { updated: 0 };

  const updates: Record<string, any> = {};
  const now = Date.now();

  snap.forEach((child) => {
    const log = child.val();
    if (log.next_due_date && log.next_due_date < now) {
      updates[`serviceLogs/${log.id}/overdue`] = true;
    }
  });

  if (Object.keys(updates).length) {
    await admin.database().ref().update(updates);
  }
  return { updated: Object.keys(updates).length };
});
