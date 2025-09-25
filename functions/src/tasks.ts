import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const tasksRef = () => admin.database().ref("tasks");

// Helper: only admin/operator can create tasks
const assertCreator = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = ctx.auth.token?.role;
  if (role !== "admin" && role !== "operator") {
    throw new HttpsError("permission-denied", "Admin or operator role required.");
  }
};

// Helper: assigned tech or admin can update
const assertAssignedOrAdmin = async (ctx: any, taskId: string) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const uid = ctx.auth.uid;
  const role = ctx.auth.token?.role;
  if (role === "admin") return true;

  const snap = await tasksRef().child(taskId).get();
  if (!snap.exists()) throw new HttpsError("not-found", "Task not found.");
  const task = snap.val() as any;
  if (task.assigned_to !== uid) {
    throw new HttpsError("permission-denied", "Only assignee or admin can update this task.");
  }
  return true;
};

// Trigger: auto-bump updatedAt
export const onTaskUpdated = db.onValueUpdated({ region: REGION, ref: "/tasks/{taskId}" }, async (event) => {
  const afterRef = event.data.after.ref;
  await afterRef.child("updatedAt").set(Date.now());
});

// Callable: create task (Admin/Operator)
export const createTask = onCall({ region: REGION }, async (req) => {
  assertCreator(req);
  const { title, description, assigned_to, generator_id, shop_id, priority } = req.data || {};
  if (!title) throw new HttpsError("invalid-argument", "title required.");

  const ref = tasksRef().push();
  const now = Date.now();
  const data = {
    title,
    description: description || "",
    status: "pending",
    priority: priority || "normal",
    assigned_to: assigned_to || null,
    generator_id: generator_id || null,
    shop_id: shop_id || null,
    createdAt: now,
    updatedAt: now
  };
  await ref.set(data);
  return { ok: true, id: ref.key, task: { id: ref.key, ...data } };
});

// Callable: update task details (Admin/Operator)
export const updateTask = onCall({ region: REGION }, async (req) => {
  assertCreator(req);
  const { id, patch } = req.data || {};
  if (!id || !patch) throw new HttpsError("invalid-argument", "id + patch required.");

  const allowed = ["title", "description", "priority", "assigned_to", "generator_id", "shop_id"];
  const updates: Record<string, any> = {};
  for (const k of allowed) if (k in patch) updates[k] = patch[k];
  if (!Object.keys(updates).length) throw new HttpsError("invalid-argument", "No valid fields in patch.");

  updates["updatedAt"] = Date.now();
  await tasksRef().child(id).update(updates);
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


// ===================== Added Endpoints & Triggers (merged safely) =====================
// The following code augments this file with: listTasks, deleteTaskSafe, listGenerators,
// listTechnicians, pushNotification helper, and RTDB notify triggers on create/update.
// - Reuses existing imports (onCall, db, admin, REGION) and tasksRef().
// - Keeps snake_case: assigned_to, generator_id, shop_id, status.
// =====================================================================================

// Extra refs
const usersRef = () => admin.database().ref("users");
const notificationsRef = (uid: string) => admin.database().ref(`notifications/${uid}`);

// Types
export type Task = {
  id?: string;
  title?: string;
  description?: string;
  status?: string; // pending | in_progress | completed | cancelled
  priority?: string;
  assigned_to?: string | null;
  generator_id?: string | null;
  shop_id?: string | null;
  createdAt?: number;
  updatedAt?: number;
  [k: string]: any;
};

export type NotificationPayload = {
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  related?: { taskId?: string; generatorId?: string | null; shopId?: string | null };
  type: "task_create" | "task_update" | "task_delete";
};

// Auth helpers (reuse your token role model)
const requireAuth = (ctx: any) => {
  if (!ctx?.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  return ctx.auth;
};

const assertAdminOrOperator = (ctx: any) => {
  const { token } = requireAuth(ctx);
  const role = token?.role;
  if (role !== "admin" && role !== "operator") {
    throw new HttpsError("permission-denied", "Admin or operator role required.");
  }
};

// Push a notification to a user's feed
/**
 * Push a notification to a user's feed in Realtime Database.
 * @param {string} uid - User ID to receive the notification.
 * @param {NotificationPayload} payload - Notification content to store.
 * @returns {{ id: string; saved: NotificationPayload }} - Saved notification id and payload.
 */
async function pushNotification(
  uid: string,
  payload: NotificationPayload
): Promise<{ id: string; saved: NotificationPayload }> {
  if (!uid) throw new Error("Missing uid for notification");
  const ref = notificationsRef(uid).push();
  const toSave = { ...payload, createdAt: payload.createdAt || Date.now(), read: false };
  await ref.set(toSave);
  return { id: ref.key as string, saved: toSave };
}

// ---- Callables ----

// List tasks with optional filters (uses indexed queries when possible)
export const listTasks = onCall({ region: REGION }, async (req) => {
  requireAuth(req);
  const { assigned_to, status, shop_id, limit = 100 } = req.data || {};

  let q: admin.database.Query = tasksRef();

  if (assigned_to) {
    q = q.orderByChild("assigned_to").equalTo(assigned_to);
  } else if (status) {
    q = q.orderByChild("status").equalTo(status);
  } else if (shop_id) {
    q = q.orderByChild("shop_id").equalTo(shop_id);
  } else {
    q = q.orderByChild("createdAt");
  }

  const snap = await q.limitToLast(Math.max(1, Math.min(1000, Number(limit) || 100))).get();
  const raw: Record<string, Task> = (snap.val() || {}) as any;

  let items = Object.entries(raw).map(([id, v]) => ({ id, ...(v as Task) }));
  if (assigned_to) items = items.filter((t) => t.assigned_to === assigned_to);
  if (status) items = items.filter((t) => t.status === status);
  if (shop_id) items = items.filter((t) => t.shop_id === shop_id);

  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return { ok: true, count: items.length, tasks: items };
});

// Delete a task safely (admin/operator). Sends a deletion notification to the assignee.
export const deleteTaskSafe = onCall({ region: REGION }, async (req) => {
  assertAdminOrOperator(req);
  const { id } = req.data || {};
  if (!id) throw new HttpsError("invalid-argument", "Task id is required.");

  const ref = tasksRef().child(id);
  const snap = await ref.get();
  if (!snap.exists()) throw new HttpsError("not-found", "Task not found.");

  const task = snap.val() as Task;
  await ref.remove();

  if (task?.assigned_to) {
    await pushNotification(task.assigned_to, {
      title: "Task Deleted",
      body: task.title ? `Task "${task.title}" was deleted` : `Task ${id} was deleted`,
      createdAt: Date.now(),
      read: false,
      related: { taskId: id, generatorId: task.generator_id || null, shopId: task.shop_id || null },
      type: "task_delete"
    });
  }

  return { ok: true };
});

// (Moved) listGenerators is implemented in generators.ts to avoid duplicate exports.

// List active technicians (role === technician && status === active)
export const listTechnicians = onCall({ region: REGION }, async (req) => {
  requireAuth(req);
  const snap = await usersRef().get();
  const val = (snap.val() || {}) as Record<string, any>;
  const list = Object.entries(val)
    .filter(([, u]) => (u?.role === "technician") && (u?.status === "active"))
    .map(([id, u]) => ({ id, ...(u as any) }));
  return { ok: true, count: list.length, technicians: list };
});

// ---- RTDB Notification Triggers ----

// Notify on task creation
export const onTaskCreatedNotify = db.onValueCreated({ region: REGION, ref: "/tasks/{taskId}" }, async (event) => {
  const task = (event.data?.val() || {}) as Task;
  const taskId = event.params?.taskId as string;

  if (task?.assigned_to) {
    await pushNotification(task.assigned_to, {
      title: "New Task Assigned",
      body: task.title ? `You were assigned: "${task.title}"` : `A new task (${taskId}) was assigned to you`,
      createdAt: Date.now(),
      read: false,
      related: { taskId, generatorId: task.generator_id || null, shopId: task.shop_id || null },
      type: "task_create"
    });
  }
});

// Notify on task updates (status changes and reassignment)
export const onTaskUpdatedNotify = db.onValueUpdated({ region: REGION, ref: "/tasks/{taskId}" }, async (event) => {
  const before = (event.data?.before.val() || {}) as Task;
  const after = (event.data?.after.val() || {}) as Task;
  const taskId = event.params?.taskId as string;

  const statusChanged = before.status !== after.status;
  const reassigned = before.assigned_to !== after.assigned_to && !!after.assigned_to;

  const notifyTargets: Array<{ uid: string; body: string }> = [];

  if (statusChanged && after.assigned_to) {
    notifyTargets.push({
      uid: after.assigned_to,
      body: after.title
        ? `Status changed to ${after.status} for "${after.title}"`
        : `Task ${taskId} status changed to ${after.status}`
    });
  }

  if (reassigned && after.assigned_to) {
    notifyTargets.push({
      uid: after.assigned_to,
      body: after.title
        ? `You were assigned: "${after.title}"`
        : `You were assigned task ${taskId}`
    });
  }

  await Promise.all(
    notifyTargets.map((t) =>
      pushNotification(t.uid, {
        title: "Task Updated",
        body: t.body,
        createdAt: Date.now(),
        read: false,
        related: { taskId, generatorId: after.generator_id || null, shopId: after.shop_id || null },
        type: "task_update"
      })
    )
  );
});

