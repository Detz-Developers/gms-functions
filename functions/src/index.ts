// functions/src/index.ts
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

// Auto-set timestamps on create
export const onShopCreate = db.onValueCreated(
  { ref: "/shops/{shopId}", region: "us-central1" },
  async (event) => {
    const shopId = event.params.shopId;
    const shop = event.data.val();
    if (!shop) return;

    const updates: Record<string, any> = {};
    if (!shop.createdAt) updates[`shops/${shopId}/createdAt`] = admin.database.ServerValue.TIMESTAMP;
    updates[`shops/${shopId}/updatedAt`] = admin.database.ServerValue.TIMESTAMP;

    if (Object.keys(updates).length) {
      await admin.database().ref().update(updates);
    }
  }
);

// Auto-bump updatedAt on any change
export const onShopUpdate = db.onValueUpdated(
  { ref: "/shops/{shopId}", region: "us-central1" },
  async (event) => {
    const shopId = event.params.shopId;
    await admin.database().ref().update({
      [`shops/${shopId}/updatedAt`]: admin.database.ServerValue.TIMESTAMP
    });
  }
);
