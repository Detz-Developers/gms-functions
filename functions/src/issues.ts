import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const issuesRef = () => admin.database().ref("issues");

// Helpers
const assertUser = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
};
const assertAdminOrInventory = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = ctx.auth.token?.role;
  if (role !== "admin" && role !== "inventory") {
    throw new HttpsError("permission-denied", "Admin/Inventory only.");
  }
};

// Auto bump updatedAt
export const onIssueUpdate = db.onValueUpdated(
  { ref: "/issues/{issueId}", region: REGION },
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

// Callable: report issue (Technician/Operator)
export const reportIssue = onCall({ region: REGION }, async (req) => {
  assertUser(req);
  const { id, equipment_type, equipment_id, description, severity = "medium" } = req.data || {};
  if (!id || !equipment_type || !equipment_id || !description) {
    throw new HttpsError("invalid-argument", "id, equipment_type, equipment_id, description required.");
  }

  const now = Date.now();
  const payload = {
    id,
    equipment_type, // "generator" | "battery" | "charger"
    equipment_id,
    description,
    severity,
    status: "open",
    createdBy: req.auth?.uid,
    createdByRole: req.auth?.token?.role,
    createdAt: now,
    updatedAt: now
  };

  await issuesRef().child(id).set(payload);
  return { ok: true, id };
});

// Callable: assign technician (Admin/Inventory)
export const assignIssue = onCall({ region: REGION }, async (req) => {
  assertAdminOrInventory(req);
  const { id, technician_id } = req.data || {};
  if (!id || !technician_id) {
    throw new HttpsError("invalid-argument", "id + technician_id required.");
  }

  await issuesRef().child(id).update({
    assigned_to: technician_id,
    updatedAt: Date.now()
  });

  // TODO: integrate with notifications.ts → notify technician
  return { ok: true };
});

// Callable: update issue status (Admin/Inventory/Assigned tech)
export const setIssueStatus = onCall({ region: REGION }, async (req) => {
  assertUser(req);
  const { id, status } = req.data || {};
  if (!id || !status) throw new HttpsError("invalid-argument", "id + status required.");

  await issuesRef().child(id).child("status").set(status);
  await issuesRef().child(id).child("updatedAt").set(Date.now());
  return { ok: true };
});

// Callable: link a gate pass (Inventory staff)
export const linkGatePass = onCall({ region: REGION }, async (req) => {
  assertAdminOrInventory(req);
  const { id, gate_pass_id } = req.data || {};
  if (!id || !gate_pass_id) throw new HttpsError("invalid-argument", "id + gate_pass_id required.");

  await issuesRef().child(id).child("gate_pass").set(gate_pass_id);
  await issuesRef().child(id).child("updatedAt").set(Date.now());
  return { ok: true };
});

