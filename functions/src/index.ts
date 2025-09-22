import admin from "firebase-admin";

// Initialize Firebase Admin SDK once
if (!admin.apps.length) {
  admin.initializeApp();
}

// Export all feature modules
export * from "./users.js";
export * from "./shops.js";
export * from "./generators.js";
export * from "./batteries.js";
export * from "./tasks.js";
export * from "./services.js";
export * from "./issues.js";
export * from "./invoices.js";
export * from "./notifications.js";
export * from "./reports.js";
