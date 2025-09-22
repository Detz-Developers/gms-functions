import { onCall, HttpsError } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const usersRef = () => admin.database().ref("users");

// Check admin role
const assertAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  if (ctx.auth.token?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
};

// Create user profile
export const createUserProfile = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);

  const { uid, email, name, role } = req.data || {};
  if (!uid || !email || !name || !role) {
    throw new HttpsError("invalid-argument", "uid, email, name, role required.");
  }

  const now = Date.now();
  await usersRef().child(uid).set({
    id: uid,
    email,
    name,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now
  });

  await admin.auth().setCustomUserClaims(uid, { role });
  return { ok: true };
});

// Update role
export const setUserRole = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { uid, role } = req.data || {};
  if (!uid || !role) throw new HttpsError("invalid-argument", "uid + role required.");

  await usersRef().child(uid).child("role").set(role);
  await admin.auth().setCustomUserClaims(uid, { role });
  return { ok: true };
});

// Enable/disable user
export const setUserStatus = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { uid, disabled } = req.data || {};
  if (!uid || typeof disabled !== "boolean") {
    throw new HttpsError("invalid-argument", "uid + disabled required.");
  }

  await admin.auth().updateUser(uid, { disabled });
  await usersRef().child(uid).child("status").set(disabled ? "disabled" : "active");
  return { ok: true };
});

