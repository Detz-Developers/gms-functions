import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const REGION = "us-central1";
const tasksRef = () => admin.database().ref("tasks");

// Helper: only admin/operator can create tasks
const assertCreator = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = ctx.auth.token?.role;
  if (role !== "admin" && role !== "operator") {
    throw new HttpsError("permission-denied", "Admin/Operator only.");
  }
};

// Everyone can update their assigned task status
const assertAssignedOrAdmin = async (ctx: any, taskId: string) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = ctx.auth.token?.role;
  if (role === "admin") return;

  const snap = await tasksRef().child(taskId).get();
  if (!snap.exists()) throw new HttpsError("not-found", "Task not found.");
  const task = snap.val();
  if (task.assigned_to !== ctx.auth.uid) {
    throw new HttpsError("permission-denied", "Not your task.");
  }
};

// Auto bump updatedAt
export const onTaskUpdate = db.onValueUpdated(
  { ref: "/tasks/{taskId}", region: REGION },
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

// Callable: create task
export const createTask = onCall({ region: REGION }, async (req) => {
  assertCreator(req);
  const { id, description, assigned_to, generator_id, due_date, priority = "Medium" } = req.data || {};
  if (!id || !description || !assigned_to) {
    throw new HttpsError("invalid-argument", "id, description, assigned_to required.");
  }

  const now = Date.now();
  const payload = {
    id,
    description,
    assigned_to,
    generator_id: generator_id ?? null,
    related_parts: [],
    due_date: due_date ?? null,
    status: "Pending",
    priority,
    createdAt: now,
    updatedAt: now,
  };

  await tasksRef().child(id).set(payload);

  // TODO: integrate with notifications.ts → sendNotification(assigned_to, ...)
  return { ok: true, id };
});

// Callable: update task (Admin/Operator)
export const updateTask = onCall({ region: REGION }, async (req) => {
  assertCreator(req);
  const { id, ...patch } = req.data || {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");

  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k !== "createdAt") updates[`tasks/${id}/${k}`] = v;
  }
  updates[`tasks/${id}/updatedAt`] = Date.now();

  await admin.database().ref().update(updates);
  return { ok: true };
});

// Callable: set status (Technician/Operator can update their own task)
export const setTaskStatus = onCall({ region: REGION }, async (req) => {
  const { id, status } = req.data || {};
  if (!id || !status) throw new HttpsError("invalid-argument", "id + status required.");

  await assertAssignedOrAdmin(req, id);

  await tasksRef().child(id).child("status").set(status);
  await tasksRef().child(id).child("updatedAt").set(Date.now());
  return { ok: true };
});
