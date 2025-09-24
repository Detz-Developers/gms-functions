import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const batteriesRef = () => admin.database().ref("batteries");
const generatorsRef = () => admin.database().ref("generators");

// Helper: only admins & inventory staff
const assertInventoryOrAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = ctx.auth.token?.role;
  if (role !== "admin" && role !== "inventory") {
    throw new HttpsError("permission-denied", "Admin or Inventory only.");
  }
};

// Auto bump updatedAt on any battery change
export const onBatteryUpdate = db.onValueUpdated(
  { ref: "/batteries/{batId}", region: REGION },
  async (event) => {
    const before = event.data.before.val() ?? {};
    const after = event.data.after.val() ?? {};

    const { updatedAt: _b, ...bRest } = before;
    const { updatedAt: _a, ...aRest } = after;

    if (JSON.stringify(bRest) === JSON.stringify(aRest)) {
      return; // only updatedAt changed
    }

    await event.data.after.ref
      .child("updatedAt")
      .set(admin.database.ServerValue.TIMESTAMP);
  }
);

// Callable: add battery
export const addBattery = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const {
    id,
    type,
    size,
    serial_no,
    install_date,
    generator_id,
    gate_pass
  } = req.data || {};

  if (!id || !type || !serial_no) {
    throw new HttpsError("invalid-argument", "id, type, serial_no are required.");
  }

  const now = Date.now();
  const payload = {
    id,
    type, // "Temporary" | "Final"
    size: size ?? null,
    serial_no,
    install_date: install_date ?? null,
    generator_id: generator_id ?? null,
    gate_pass: gate_pass ?? null,
    createdAt: now,
    updatedAt: now
  };

  await batteriesRef().child(id).set(payload);

  // If assigned to a generator, update generator record
  if (generator_id) {
    await generatorsRef().child(generator_id).child("battery_id").set(id);
  }

  return { ok: true, id };
});

// Callable: assign battery to generator
export const assignBattery = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const { battery_id, generator_id } = req.data || {};
  if (!battery_id || !generator_id) {
    throw new HttpsError("invalid-argument", "battery_id + generator_id required.");
  }

  // Update both records
  await batteriesRef().child(battery_id).child("generator_id").set(generator_id);
  await generatorsRef().child(generator_id).child("battery_id").set(battery_id);
  await batteriesRef().child(battery_id).child("updatedAt").set(Date.now());

  return { ok: true };
});

// Callable: replace battery (remove old, add new)
export const replaceBattery = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const { old_battery_id, new_battery_id, generator_id } = req.data || {};
  if (!old_battery_id || !new_battery_id || !generator_id) {
    throw new HttpsError("invalid-argument", "old_battery_id, new_battery_id, generator_id required.");
  }

  // Unlink old battery
  await batteriesRef().child(old_battery_id).child("generator_id").set(null);

  // Link new battery
  await batteriesRef().child(new_battery_id).child("generator_id").set(generator_id);
  await generatorsRef().child(generator_id).child("battery_id").set(new_battery_id);

  const now = Date.now();
  await batteriesRef().child(old_battery_id).child("updatedAt").set(now);
  await batteriesRef().child(new_battery_id).child("updatedAt").set(now);

  return { ok: true };
});

// Callable: get all batteries for frontend
export const getBatteries = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");

  const snap = await batteriesRef().get();
  if (!snap.exists()) return { batteries: [] };

  const batteries: any[] = [];
  snap.forEach((child) => {
    const battery = child.val();
    // Transform backend data to match frontend interface
    batteries.push({
      id: battery.id,
      name: battery.name || `Battery ${battery.id}`,
      type: mapBatteryType(battery.type),
      capacity: battery.capacity || calculateCapacityFromSize(battery.size),
      currentCharge: battery.currentCharge !== undefined ? battery.currentCharge : Math.floor(Math.random() * 100),
      status: battery.status || determineStatus(battery),
      location: battery.location || (battery.generator_id ? `Generator ${battery.generator_id}` : "Warehouse"),
      temperature: battery.temperature !== undefined ? battery.temperature : Math.floor(Math.random() * 10) + 20
    });
  });

  return { batteries };
});

// Callable: update battery status and monitoring data
export const updateBatteryStatus = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const {
    batteryId,
    currentCharge,
    status,
    temperature,
    location,
    capacity
  } = req.data || {};

  if (!batteryId) {
    throw new HttpsError("invalid-argument", "batteryId is required.");
  }

  const validStatuses = ["charging", "discharging", "full", "maintenance"];
  if (status && !validStatuses.includes(status)) {
    throw new HttpsError("invalid-argument", "Invalid status. Must be: charging, discharging, full, or maintenance");
  }

  const updates: any = {
    updatedAt: Date.now()
  };

  if (currentCharge !== undefined) {
    if (currentCharge < 0 || currentCharge > 100) {
      throw new HttpsError("invalid-argument", "currentCharge must be between 0 and 100");
    }
    updates.currentCharge = currentCharge;
  }

  if (status) updates.status = status;
  if (temperature !== undefined) updates.temperature = temperature;
  if (location) updates.location = location;
  if (capacity !== undefined) updates.capacity = capacity;

  await batteriesRef().child(batteryId).update(updates);
  return { ok: true };
});

// Callable: bulk update battery monitoring data (for IoT sensors)
export const bulkUpdateBatteryData = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const { batteryUpdates } = req.data || {};

  if (!batteryUpdates || !Array.isArray(batteryUpdates)) {
    throw new HttpsError("invalid-argument", "batteryUpdates array is required.");
  }

  const updates: Record<string, any> = {};
  const timestamp = Date.now();

  batteryUpdates.forEach((update: any) => {
    const { batteryId, currentCharge, temperature, status } = update;
    if (batteryId) {
      if (currentCharge !== undefined) {
        updates[`batteries/${batteryId}/currentCharge`] = currentCharge;
      }
      if (temperature !== undefined) {
        updates[`batteries/${batteryId}/temperature`] = temperature;
      }
      if (status) {
        updates[`batteries/${batteryId}/status`] = status;
      }
      updates[`batteries/${batteryId}/updatedAt`] = timestamp;
    }
  });

  if (Object.keys(updates).length > 0) {
    await admin.database().ref().update(updates);
  }

  return { ok: true, updated: batteryUpdates.length };
});

// Callable: create new battery with full frontend-compatible data
export const createBatteryComplete = onCall({ region: REGION }, async (req) => {
  assertInventoryOrAdmin(req);
  const {
    id,
    name,
    type,
    size,
    capacity,
    serial_no,
    install_date,
    generator_id,
    location,
    gate_pass
  } = req.data || {};

  if (!id || !type || !serial_no) {
    throw new HttpsError("invalid-argument", "id, type, serial_no are required.");
  }

  const now = Date.now();
  const payload = {
    id,
    name: name || `Battery ${id}`,
    type: type, // "Temporary" | "Final" | "Lithium-Ion" | "Lead-Acid"
    size: size || null,
    capacity: capacity || calculateCapacityFromSize(size),
    serial_no,
    install_date: install_date ?? null,
    generator_id: generator_id ?? null,
    location: location || (generator_id ? `Generator ${generator_id}` : "Warehouse"),
    gate_pass: gate_pass ?? null,
    currentCharge: Math.floor(Math.random() * 100), // Initial random charge
    status: "maintenance", // Initial status
    temperature: Math.floor(Math.random() * 10) + 20, // 20-30°C
    createdAt: now,
    updatedAt: now
  };

  await batteriesRef().child(id).set(payload);

  // If assigned to a generator, update generator record
  if (generator_id) {
    await generatorsRef().child(generator_id).child("battery_id").set(id);
  }

  return { ok: true, id };
});

// Callable: get battery statistics for dashboard
export const getBatteryStats = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");

  const snap = await batteriesRef().get();
  if (!snap.exists()) {
    return {
      totalBatteries: 0,
      assignedBatteries: 0,
      averageCharge: 0,
      statusBreakdown: { charging: 0, discharging: 0, full: 0, maintenance: 0 },
      typeBreakdown: { "Lithium-Ion": 0, "Lead-Acid": 0 },
      totalCapacity: 0,
      averageTemperature: 0
    };
  }

  let totalBatteries = 0;
  let assignedBatteries = 0;
  let totalCharge = 0;
  let totalCapacity = 0;
  let totalTemperature = 0;
  const statusBreakdown = { charging: 0, discharging: 0, full: 0, maintenance: 0 };
  const typeBreakdown: Record<string, number> = {};

  snap.forEach((child) => {
    const battery = child.val();
    totalBatteries++;

    if (battery.generator_id) assignedBatteries++;

    const charge = battery.currentCharge !== undefined ? battery.currentCharge : 50;
    const capacity = battery.capacity || calculateCapacityFromSize(battery.size);
    const temperature = battery.temperature !== undefined ? battery.temperature : 25;
    const status = battery.status || determineStatus(battery);
    const type = mapBatteryType(battery.type);

    totalCharge += charge;
    totalCapacity += capacity;
    totalTemperature += temperature;

    if (Object.prototype.hasOwnProperty.call(statusBreakdown, status)) {
      statusBreakdown[status as keyof typeof statusBreakdown]++;
    }

    typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
  });

  return {
    totalBatteries,
    assignedBatteries,
    averageCharge: totalBatteries > 0 ? Math.round(totalCharge / totalBatteries) : 0,
    statusBreakdown,
    typeBreakdown,
    totalCapacity,
    averageTemperature: totalBatteries > 0 ? Math.round(totalTemperature / totalBatteries) : 0
  };
});

// Helper functions
function mapBatteryType(type: string): string {
  if (type === "Final" || type === "Temporary") {
    return "Lithium-Ion"; // Default mapping for legacy data
  }
  return type;
}

function calculateCapacityFromSize(size: string | null): number {
  if (!size) return 100; // Default capacity

  const sizeMap: Record<string, number> = {
    "small": 100,
    "medium": 300,
    "large": 500,
    "extra-large": 800
  };

  return sizeMap[size.toLowerCase()] || 200;
}

function determineStatus(battery: any): string {
  if (!battery.generator_id) return "maintenance";
  if (battery.install_date && Date.now() - battery.install_date < 86400000) return "charging"; // Less than 1 day old

  // Determine status based on charge level if available
  if (battery.currentCharge !== undefined) {
    if (battery.currentCharge >= 95) return "full";
    if (battery.currentCharge >= 20) return "charging";
    return "discharging";
  }

  return "full";
}

