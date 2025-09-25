import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) admin.initializeApp();

const ref = () => admin.database().ref("batteries");
const genRef = () => admin.database().ref("generators");

const assertInventoryOrAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = ctx.auth.token?.role;
  if (role !== "admin" && role !== "inventory") {
    throw new HttpsError("permission-denied", "Admin or Inventory only.");
  }
};

const ALLOWED_ISSUE_TYPES = ["Fix", "Temporary"] as const;
type IssueType = (typeof ALLOWED_ISSUE_TYPES)[number];

const nextId = async (): Promise<string> => {
  const snap = await ref().once("value");
  let max = 0;
  if (snap.exists()) {
    snap.forEach((c) => {
      const id: string = (c.val()?.id ?? c.key) as string;
      const m = /^BT(\d+)$/.exec(id ?? "");
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n)) max = Math.max(max, n);
      }
      return false;
    });
  }
  return "BT" + String(max + 1).padStart(4, "0");
};

export const onBatteryUpdate = db.onValueUpdated(
  { ref: "/batteries/{batId}", region: REGION },
  async (event) => {
    const before = event.data.before.val() ?? {};
    const after = event.data.after.val() ?? {};
    const { updatedAt: _b, ...b } = before;
    const { updatedAt: _a, ...a } = after;
    if (JSON.stringify(b) === JSON.stringify(a)) return;
    await event.data.after.ref.child("updatedAt").set(admin.database.ServerValue.TIMESTAMP);
  }
);

export const createBattery = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const {
    size,
    serial_no,
    issued_date,
    install_date,
    generator_id,
    shop_id,
    issue_type = "Fix",
    gate_pass
  }: {
    size?: string | null;
    serial_no?: string;
    issued_date?: number | null;
    install_date?: number | null;
    generator_id?: string | null;
    shop_id?: string | null;
    issue_type?: IssueType;
    gate_pass?: string | null;
  } = req.data ?? {};

  if (!serial_no) throw new HttpsError("invalid-argument", "serial_no is required.");
  if (!ALLOWED_ISSUE_TYPES.includes(issue_type)) {
    throw new HttpsError("invalid-argument", `issue_type must be ${ALLOWED_ISSUE_TYPES.join(" | ")}`);
  }
  if (issue_type === "Temporary" && !gate_pass) {
    throw new HttpsError("invalid-argument", "gate_pass is required for Temporary issue_type.");
  }
  if (generator_id && shop_id) {
    throw new HttpsError("invalid-argument", "Provide either generator_id or shop_id, not both.");
  }

  const id = await nextId();
  const now = Date.now();

  const payload = {
    id,
    size: size ?? null,
    serial_no,
    issued_date: issued_date ?? null,
    install_date: install_date ?? null,
    generator_id: generator_id ?? null,
    shop_id: shop_id ?? null,
    issue_type,
    gate_pass: gate_pass ?? null,
    createdAt: now,
    updatedAt: now
  };

  await ref().child(id).set(payload);
  if (generator_id) await genRef().child(generator_id).child("battery_id").set(id);

  return { ok: true, id };
});

export const updateBattery = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const { id, ...patch } = req.data ?? {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");

  const r = ref().child(id);
  const snap = await r.once("value");
  if (!snap.exists()) throw new HttpsError("not-found", `Battery ${id} not found.`);

  if ("id" in patch) delete (patch as any).id;
  if ("createdAt" in patch) delete (patch as any).createdAt;

  if ("issue_type" in patch) {
    const t = patch.issue_type as IssueType;
    if (!ALLOWED_ISSUE_TYPES.includes(t)) {
      throw new HttpsError("invalid-argument", `issue_type must be ${ALLOWED_ISSUE_TYPES.join(" | ")}`);
    }
    if (t === "Temporary" && !patch.gate_pass && !snap.val()?.gate_pass) {
      throw new HttpsError("invalid-argument", "gate_pass is required when setting issue_type to Temporary.");
    }
  }

  if ("generator_id" in patch && "shop_id" in patch && patch.generator_id && patch.shop_id) {
    throw new HttpsError("invalid-argument", "Provide either generator_id or shop_id, not both.");
  }

  const updates: Record<string, any> = { ...patch, updatedAt: Date.now() };
  await r.update(updates);

  if ("generator_id" in patch) {
    const newGen = patch.generator_id ?? null;
    const prevGen = snap.val()?.generator_id ?? null;
    if (prevGen && prevGen !== newGen) await genRef().child(prevGen).child("battery_id").set(null);
    if (newGen) await genRef().child(newGen).child("battery_id").set(id);
  }

  return { ok: true };
});

export const deleteBattery = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const { id } = req.data ?? {};
  if (!id) throw new HttpsError("invalid-argument", "id required.");

  const r = ref().child(id);
  const snap = await r.once("value");
  if (!snap.exists()) throw new HttpsError("not-found", `Battery ${id} not found.`);

  const battery = snap.val();
  if (battery.generator_id) await genRef().child(battery.generator_id).child("battery_id").set(null);

  await r.remove();
  return { ok: true, id };
});

export const assignBattery = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const { battery_id, generator_id } = req.data ?? {};
  if (!battery_id || !generator_id) throw new HttpsError("invalid-argument", "battery_id and generator_id required.");

  const r = ref().child(battery_id);
  const snap = await r.once("value");
  if (!snap.exists()) throw new HttpsError("not-found", `Battery ${battery_id} not found.`);

  const prevGen = snap.val()?.generator_id ?? null;
  if (prevGen && prevGen !== generator_id) await genRef().child(prevGen).child("battery_id").set(null);

  await r.update({ generator_id, shop_id: null, updatedAt: Date.now() });
  await genRef().child(generator_id).child("battery_id").set(battery_id);
  return { ok: true };
});

