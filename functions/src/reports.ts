import * as scheduler from "firebase-functions/v2/scheduler";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}


// Scheduled function: generate monthly summary report
export const generateMonthlyReport = scheduler.onSchedule(
  {
    schedule: "0 0 1 * *", // every 1st of the month at midnight
    region: REGION,
    timeZone: "Asia/Colombo"
  },
  async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-based
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

    const db = admin.database();

    const [gensSnap, tasksSnap, issuesSnap, invoicesSnap] = await Promise.all([
      db.ref("generators").get(),
      db.ref("tasks").get(),
      db.ref("issues").get(),
      db.ref("invoices").get()
    ]);

    const generators = gensSnap.exists() ? Object.values(gensSnap.val()) : [];
    const tasks = tasksSnap.exists() ? Object.values(tasksSnap.val()) : [];
    const issues = issuesSnap.exists() ? Object.values(issuesSnap.val()) : [];
    const invoices = invoicesSnap.exists() ? Object.values(invoicesSnap.val()) : [];

    // Compute stats
    const stats = {
      totalGenerators: (generators as any[]).length,
      activeGenerators: (generators as any[]).filter((g) => g["status"] === "Active").length,
      tasksCompleted: (tasks as any[]).filter((t) => t["status"] === "Completed").length,
      tasksPending: (tasks as any[]).filter((t) => t["status"] === "Pending").length,
      openIssues: (issues as any[]).filter((i) => i["status"] === "open").length,
      invoicesPaid: (invoices as any[]).filter((inv) => inv["status"] === "Paid").length,
      invoicesPending: (invoices as any[]).filter((inv) => inv["status"] === "Pending").length,
      generatedAt: Date.now()
    };

    await db.ref(`reports/monthly/${monthKey}`).set(stats);
    return;
  }
);

// Scheduled function: daily summary (for dashboard quick view)
export const generateDailyReport = scheduler.onSchedule(
  {
    schedule: "0 0 * * *", // every day midnight
    region: REGION,
    timeZone: "Asia/Colombo"
  },
  async () => {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const db = admin.database();
    const [tasksSnap, issuesSnap] = await Promise.all([
      db.ref("tasks").get(),
      db.ref("issues").get()
    ]);

    const tasks = tasksSnap.exists() ? Object.values(tasksSnap.val()) : [];
    const issues = issuesSnap.exists() ? Object.values(issuesSnap.val()) : [];

    const stats = {
      tasksDueToday: (tasks as any[]).filter((t) => {
        if (!t["due_date"]) return false;
        const due = new Date(t["due_date"]).toISOString().split("T")[0];
        return due === today;
      }).length,
      newIssues: (issues as any[]).filter((i) => {
        const created = new Date(i["createdAt"]).toISOString().split("T")[0];
        return created === today;
      }).length,
      generatedAt: Date.now()
    };

    await db.ref(`reports/daily/${today}`).set(stats);
    return;
  }
);

