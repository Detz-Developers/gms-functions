import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const REGION = "us-central1";
const notificationsRef = (uid: string) =>
  admin.database().ref(`notifications/${uid}`);

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

// Utility: push a notification for a user
export const sendNotification = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { uid, title, body, type, related_id } = req.data || {};
  if (!uid || !title) {
    throw new HttpsError("invalid-argument", "uid + title required.");
  }

  const now = Date.now();
  const notifId = admin.database().ref().push().key!;

  const payload = {
    id: notifId,
    title,
    body: body ?? "",
    type: type ?? "general", // task, issue, invoice, etc.
    related_id: related_id ?? null,
    read: false,
    createdAt: now,
  };

  await notificationsRef(uid).child(notifId).set(payload);
  return { ok: true, id: notifId };
});

// Callable: mark as read
export const markNotificationRead = onCall({ region: REGION }, async (req) => {
  assertAuth(req);
  const { id } = req.data || {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");

  const uid = req.auth?.uid!;
  await notificationsRef(uid).child(id).child("read").set(true);
  return { ok: true };
});

// Callable: clear all (Admin or user themselves)
export const clearNotifications = onCall({ region: REGION }, async (req) => {
  assertAuth(req);
  const uid = req.auth?.uid!;
  if (req.auth?.token?.role === "admin" && req.data?.targetUid) {
    // Admin clearing another user’s inbox
    await notificationsRef(req.data.targetUid).remove();
  } else {
    // User clears their own
    await notificationsRef(uid).remove();
  }
  return { ok: true };
});
