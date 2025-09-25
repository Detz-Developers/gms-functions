
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onValueWritten } from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) admin.initializeApp();
const INVOICES_PATH = "/invoices";

// Types
type InvoiceStatus = "Pending" | "Paid" | "Overdue";

export interface LineItem {
  description?: string;
  qty?: number; // optional if amount given
  unit_price?: number; // optional if amount given
  amount?: number; // optional if qty*unit_price used
}

export interface Invoice {
  id: string; // manual (admin provided)
  date: number; // ms epoch
  line_items: LineItem[];
  amount: number; // computed or override
  status: InvoiceStatus;
  due_date?: number | null; // ms epoch or null
  description?: string; // top-level description
  company_name?: string; // for B2B invoices
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch
}

// Helpers
const invoicesRef = () => admin.database().ref(INVOICES_PATH);

const assertAdmin = (req: CallableRequest<any>) => {
  // Expect a custom claim "role=admin" or "isAdmin=true".
  // Adjust this to match your auth model.
  const role = req.auth?.token?.role;
  const isAdmin = (req.auth?.token as any)?.isAdmin;
  if (role !== "admin" && !isAdmin) {
    throw new HttpsError("permission-denied", "Admin privileges required.");
  }
};

const safeNumber = (n: any, fallback = 0): number =>
  typeof n === "number" && Number.isFinite(n) ? n : fallback;

const computeTotalFromItems = (items: LineItem[] = []): number => {
  let total = 0;
  for (const it of items) {
    if (typeof it.amount === "number" && Number.isFinite(it.amount)) {
      total += it.amount;
    } else if (
      typeof it.qty === "number" &&
      typeof it.unit_price === "number" &&
      Number.isFinite(it.qty) &&
      Number.isFinite(it.unit_price)
    ) {
      total += it.qty * it.unit_price;
    }
  }
  return Math.max(0, Math.round(total * 100) / 100); // round to cents if you want
};

const getInvoiceById = async (id: string) => {
  const snap = await invoicesRef().child(id).get();
  return snap.exists() ? (snap.val() as Invoice) : null;
};

// Create Invoice (Admin-only)
// - Manual ID
// - Optional amount override
// - description, company_name, due_date supported
export const createInvoice = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);

  const {
    id,
    date,
    line_items = [],
    due_date = null,
    description = "",
    company_name = "",
    amount: amountOverride // number | undefined
  } = (req.data || {}) as Partial<Invoice> & { amount?: number };

  if (!id || typeof id !== "string") {
    throw new HttpsError("invalid-argument", "A manual string 'id' is required.");
  }

  // Ensure uniqueness for manual IDs
  const existing = await getInvoiceById(id);
  if (existing) {
    throw new HttpsError("already-exists", `Invoice '${id}' already exists.`);
  }

  // Compute total from line_items if override not provided
  const computed = computeTotalFromItems(line_items);
  const amount = typeof amountOverride === "number" ? safeNumber(amountOverride) : computed;

  const now = Date.now();
  const invoice: Invoice = {
    id,
    date: typeof date === "number" ? date : now,
    line_items: Array.isArray(line_items) ? line_items : [],
    amount,
    status: "Pending",
    due_date: typeof due_date === "number" ? due_date : null,
    description,
    company_name,
    createdAt: now,
    updatedAt: now
  };

  await invoicesRef().child(id).set(invoice);
  return { ok: true, id, amount };
});

// Update Invoice (Admin-only, only while not Paid)
// - Can edit description, company_name, due_date
// - Can replace line_items and recompute amount OR accept override
export const updateInvoice = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);

  const {
    id,
    description,
    company_name,
    due_date,
    line_items,
    amount, // override
    date
  } = req.data || {};

  if (!id || typeof id !== "string") {
    throw new HttpsError("invalid-argument", "id is required.");
  }

  const inv = await getInvoiceById(id);
  if (!inv) throw new HttpsError("not-found", "Invoice not found.");
  if (inv.status === "Paid") {
    throw new HttpsError("failed-precondition", "Paid invoices cannot be edited.");
  }

  const updates: Partial<Invoice> & Record<string, any> = {};

  if (typeof description === "string") updates.description = description;
  if (typeof company_name === "string") updates.company_name = company_name;
  if (due_date === null || typeof due_date === "number") updates.due_date = due_date;
  if (typeof date === "number") updates.date = date;

  if (Array.isArray(line_items)) {
    updates.line_items = line_items;
    const computed = computeTotalFromItems(line_items);
    updates.amount = typeof amount === "number" ? safeNumber(amount) : computed;
  } else if (typeof amount === "number") {
    updates.amount = safeNumber(amount);
  }

  updates.updatedAt = Date.now();
  await invoicesRef().child(id).update(updates);
  return { ok: true };
});

// Mark Invoice Paid (Admin-only)
// Sets status to "Paid" and stamps updatedAt
export const markInvoicePaid = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { id } = req.data || {};
  if (!id || typeof id !== "string") {
    throw new HttpsError("invalid-argument", "id is required.");
  }

  const inv = await getInvoiceById(id);
  if (!inv) throw new HttpsError("not-found", "Invoice not found.");

  await invoicesRef().child(id).update({
    status: "Paid" as InvoiceStatus,
    updatedAt: Date.now()
  });

  return { ok: true };
});

// Update Invoice Status (Admin-only)
// - Accepts: "Pending" | "Paid" | "Overdue"
export const updateInvoiceStatus = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { id, status } = req.data || {};
  if (!id || typeof id !== "string") {
    throw new HttpsError("invalid-argument", "id is required.");
  }
  if (!["Pending", "Paid", "Overdue"].includes(status)) {
    throw new HttpsError("invalid-argument", "status must be Pending | Paid | Overdue.");
  }

  const inv = await getInvoiceById(id);
  if (!inv) throw new HttpsError("not-found", "Invoice not found.");

  await invoicesRef().child(id).update({
    status,
    updatedAt: Date.now()
  });

  return { ok: true };
});

// Mark Overdue Nightly (Scheduler)
// - Runs 01:00 daily, marks Pending invoices as Overdue when past due_date
export const markOverdueNightly = onSchedule(
  { region: REGION, schedule: "every day 01:00" },
  async () => {
    const snap = await invoicesRef().get();
    const now = Date.now();
    const updates: Record<string, any> = {};

    snap.forEach((child) => {
      const inv = child.val() as Invoice;
      if (
        inv &&
        inv.status === "Pending" &&
        typeof inv.due_date === "number" &&
        inv.due_date < now
      ) {
        updates[`${child.key}/status`] = "Overdue";
        updates[`${child.key}/updatedAt`] = now;
      }
    });

    if (Object.keys(updates).length) {
      await invoicesRef().update(updates);
    }
  }
);

// RTDB Trigger: Maintain updatedAt on any write to /invoices/{id}
// - If client/devs forget to set updatedAt, we still patch it.
export const onInvoiceWrite = onValueWritten(
  { ref: `${INVOICES_PATH}/{invoiceId}`, region: REGION },
  async (event) => {
    const after = event.data.after.val();
    if (!after) return;

    const id = event.params.invoiceId;
    // Only bump if missing or clearly stale
    const updatedAt = typeof after.updatedAt === "number" ? after.updatedAt : 0;
    const now = Date.now();
    if (now - updatedAt > 1000) {
      await invoicesRef().child(id).update({ updatedAt: now });
    }
  }
);

// (Optional) Get/List helpers - lightweight and handy for UI wiring
export const getInvoice = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { id } = req.data || {};
  if (!id || typeof id !== "string") {
    throw new HttpsError("invalid-argument", "id is required.");
  }
  const inv = await getInvoiceById(id);
  if (!inv) throw new HttpsError("not-found", "Invoice not found.");
  return inv;
});

export const listInvoices = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { limit = 100, status } = req.data || {};
  const snap = await invoicesRef().limitToLast(Math.min(500, limit)).get();
  const out: Invoice[] = [];
  snap.forEach((child) => {
    const inv = child.val() as Invoice;
    if (status && inv.status !== status) return;
    out.push(inv);
  });
  // sort desc by date
  out.sort((a, b) => b.date - a.date);
  return out.slice(0, Math.min(out.length, Math.max(1, limit)));
});
