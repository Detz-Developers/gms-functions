// functions/src/shops.ts
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

// Auto-set timestamps on create
export const onShopCreate = db.onValueCreated(
  { ref: "/shops/{shopId}", region: REGION },
  async (event) => {
    const shopId = event.params.shopId;
    const shop = event.data.val();
    if (!shop) return;

    const updates: Record<string, any> = {};
    if (!shop.createdAt) {
      updates[`shops/${shopId}/createdAt`] = admin.database.ServerValue.TIMESTAMP;
    }
    updates[`shops/${shopId}/updatedAt`] = admin.database.ServerValue.TIMESTAMP;

    if (Object.keys(updates).length) {
      await admin.database().ref().update(updates);
    }
  }
);

// Auto-bump updatedAt on any change, but ignore updates that only touch updatedAt
export const onShopUpdate = db.onValueUpdated(
  { ref: "/shops/{shopId}", region: REGION },
  async (event) => {
    const before = event.data.before.val() ?? {};
    const after = event.data.after.val() ?? {};

    // compare without the updatedAt field
    const { updatedAt: _b, ...bRest } = before;
    const { updatedAt: _a, ...aRest } = after;

    if (JSON.stringify(bRest) === JSON.stringify(aRest)) {
      // the only difference was updatedAt -> avoid infinite loop
      return;
    }

    await event.data.after.ref
      .child("updatedAt")
      .set(admin.database.ServerValue.TIMESTAMP);
  }
);

