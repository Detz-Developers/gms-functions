import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

// DB ref helper
const notificationsRef = (role: string, uid: string) =>
  admin.database().ref(`notifications/${role}/${uid}`);

// Helpers
const assertAuth = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
};

const assertAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  if (ctx.auth.token?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
};

// 🔹 Send a notification (Admin only)
export const sendNotification = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { uid, role, title, body, type, related_id } = req.data || {};

  if (!uid || !role || !title) {
    throw new HttpsError("invalid-argument", "uid + role + title required.");
  }

  const now = Date.now();
  const notifId = admin.database().ref().push().key;
  if (!notifId) {
    throw new HttpsError("internal", "Failed to generate notification id.");
  }

  const payload = {
    id: notifId,
    title,
    body: body ?? "",
    type: type ?? "general", // task, issue, invoice, etc.
    related_id: related_id ?? null,
    read: false,
    createdAt: now
  };

  await notificationsRef(role, uid).child(notifId).set(payload);
  return { ok: true, id: notifId };
});

// 🔹 Mark as read
export const markNotificationRead = onCall({ region: REGION }, async (req) => {
  assertAuth(req);
  const { id, role } = req.data || {};
  const uid = req.auth?.uid;

  if (!id || !role) throw new HttpsError("invalid-argument", "id + role required.");
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  await notificationsRef(role, uid).child(id).child("read").set(true);
  return { ok: true };
});

// 🔹 Clear all notifications
export const clearNotifications = onCall({ region: REGION }, async (req) => {
  assertAuth(req);
  const { role, targetUid } = req.data || {};
  const uid = req.auth?.uid;

  if (!role) throw new HttpsError("invalid-argument", "role required.");
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  if (req.auth?.token?.role === "admin" && targetUid) {
    // Admin clearing another user’s inbox
    await notificationsRef(role, targetUid).remove();
  } else {
    // User clears their own
    await notificationsRef(role, uid).remove();
  }
  return { ok: true };
});
