import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as db from "firebase-functions/v2/database";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

const serviceLogsRef = () => admin.database().ref("serviceLogs");
const generatorsRef = () => admin.database().ref("generators");

// Helpers
const assertTechnicianOrAdmin = (ctx: any) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = ctx.auth.token?.role;
  if (role !== "admin" && role !== "technician") {
    throw new HttpsError("permission-denied", "Admin/Technician only.");
  }
};

// Auto bump updatedAt on service log changes
export const onServiceLogUpdate = db.onValueUpdated(
  { ref: "/serviceLogs/{logId}", region: REGION },
  async (event) => {
    const before = event.data.before.val() ?? {};
    const after = event.data.after.val() ?? {};

    const { updatedAt: _b, ...bRest } = before;
    const { updatedAt: _a, ...aRest } = after;

    if (JSON.stringify(bRest) === JSON.stringify(aRest)) return;

    await event.data.after.ref
      .child("updatedAt")
      .set(admin.database.ServerValue.TIMESTAMP);
  }
);


export const logService = onCall({ region: REGION }, async (req) => {
  assertTechnicianOrAdmin(req);
  const {
    id,
    generator_id,
    technician_id,
    service_type,
    service_date,
    next_due_date,
    notes
  } = req.data || {};

  if (!id || !generator_id || !technician_id || !service_type) {
    throw new HttpsError("invalid-argument", "id, generator_id, technician_id, service_type required.");
  }

  const now = Date.now();
  const payload = {
    id,
    generator_id,
    technician_id,
    service_type,
    service_date: service_date ?? now,
    next_due_date: next_due_date ?? null,
    notes: notes ?? "",
    overdue: next_due_date ? Date.now() > next_due_date : false,
    createdAt: now,
    updatedAt: now
  };

  await serviceLogsRef().child(id).set(payload);

  // Optional: update generator's last_service_date
  await generatorsRef().child(generator_id).child("last_service_date").set(service_date ?? now);

  return { ok: true, id };
});

// Callable: mark overdue services (Admin/Technician)
export const markOverdueServices = onCall({ region: REGION }, async (req) => {
  assertTechnicianOrAdmin(req);

  const snap = await serviceLogsRef().get();
  if (!snap.exists()) return { updated: 0 };

  const updates: Record<string, any> = {};
  const now = Date.now();

  snap.forEach((child) => {
    const log = child.val();
    if (log.next_due_date && log.next_due_date < now) {
      updates[`serviceLogs/${log.id}/overdue`] = true;
    }
  });

  if (Object.keys(updates).length) {
    await admin.database().ref().update(updates);
  }
  return { updated: Object.keys(updates).length };
});

// Callable: get all services for frontend
export const getServices = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");

  const snap = await serviceLogsRef().get();
  if (!snap.exists()) return { services: [] };

  const services: any[] = [];
  snap.forEach((child) => {
    const log = child.val();
    // Transform backend data to match frontend interface
    services.push({
      id: log.id,
      name: log.name ||
        `${log.service_type.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())} Service`,
      type: mapServiceType(log.service_type),
      provider: log.provider || "Internal Team",
      cost: log.cost || 0,
      status: log.status || mapServiceStatus(log),
      scheduledDate: new Date(log.service_date).toISOString().split("T")[0],
      generatorId: log.generator_id,
      description: log.description || log.notes ||
        `${log.service_type.replace(/_/g, " ")} service for generator ${log.generator_id}`
    });
  });

  return { services };
});

// Callable: create service request
export const createService = onCall({ region: REGION }, async (req) => {
  assertTechnicianOrAdmin(req);
  const {
    id,
    name,
    type,
    provider,
    cost,
    scheduledDate,
    generatorId,
    description
  } = req.data || {};

  if (!id || !name || !type) {
    throw new HttpsError("invalid-argument", "id, name, type are required.");
  }

  const validTypes = ["maintenance", "repair", "inspection", "installation"];
  if (!validTypes.includes(type)) {
    throw new HttpsError("invalid-argument",
      "Invalid service type. Must be: maintenance, repair, inspection, or installation");
  }

  const now = Date.now();
  const scheduledTimestamp = scheduledDate ? new Date(scheduledDate).getTime() : now;

  const payload = {
    id,
    name,
    generator_id: generatorId || null,
    technician_id: req.auth?.uid || null,
    service_type: type,
    service_date: scheduledTimestamp,
    next_due_date: null,
    notes: description || "",
    description: description || "",
    provider: provider || "Internal Team",
    cost: cost || 0,
    status: "scheduled",
    overdue: false,
    createdAt: now,
    updatedAt: now
  };

  await serviceLogsRef().child(id).set(payload);
  return { ok: true, id };
});

// Callable: update service status
export const updateServiceStatus = onCall({ region: REGION }, async (req) => {
  assertTechnicianOrAdmin(req);
  const { serviceId, status } = req.data || {};

  if (!serviceId || !status) {
    throw new HttpsError("invalid-argument", "serviceId and status are required.");
  }

  const validStatuses = ["scheduled", "in-progress", "completed", "cancelled"];
  if (!validStatuses.includes(status)) {
    throw new HttpsError("invalid-argument", "Invalid status value.");
  }

  await serviceLogsRef().child(serviceId).update({
    status,
    updatedAt: Date.now()
  });

  return { ok: true };
});

// Callable: bulk update service statuses
export const bulkUpdateServiceStatus = onCall({ region: REGION }, async (req) => {
  assertTechnicianOrAdmin(req);
  const { serviceUpdates } = req.data || {};

  if (!serviceUpdates || !Array.isArray(serviceUpdates)) {
    throw new HttpsError("invalid-argument", "serviceUpdates array is required.");
  }

  const validStatuses = ["scheduled", "in-progress", "completed", "cancelled"];
  const updates: Record<string, any> = {};
  const timestamp = Date.now();

  serviceUpdates.forEach((update: any) => {
    const { serviceId, status, cost, notes } = update;
    if (serviceId && status && validStatuses.includes(status)) {
      updates[`serviceLogs/${serviceId}/status`] = status;
      if (cost !== undefined) updates[`serviceLogs/${serviceId}/cost`] = cost;
      if (notes) updates[`serviceLogs/${serviceId}/notes`] = notes;
      updates[`serviceLogs/${serviceId}/updatedAt`] = timestamp;
    }
  });

  if (Object.keys(updates).length > 0) {
    await admin.database().ref().update(updates);
  }

  return { ok: true, updated: serviceUpdates.length };
});

// Callable: get service statistics for dashboard
export const getServiceStats = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");

  const snap = await serviceLogsRef().get();
  if (!snap.exists()) {
    return {
      totalServices: 0,
      completedServices: 0,
      totalCost: 0,
      statusBreakdown: { "scheduled": 0, "in-progress": 0, "completed": 0, "cancelled": 0 },
      typeBreakdown: { maintenance: 0, repair: 0, inspection: 0, installation: 0 }
    };
  }

  let totalServices = 0;
  let completedServices = 0;
  let totalCost = 0;
  const statusBreakdown = { "scheduled": 0, "in-progress": 0, "completed": 0, "cancelled": 0 };
  const typeBreakdown = { maintenance: 0, repair: 0, inspection: 0, installation: 0 };

  snap.forEach((child) => {
    const log = child.val();
    totalServices++;
    totalCost += log.cost || 0;

    const status = log.status || mapServiceStatus(log);
    const type = mapServiceType(log.service_type);

    if (status === "completed") completedServices++;

    if (Object.prototype.hasOwnProperty.call(statusBreakdown, status)) {
      statusBreakdown[status as keyof typeof statusBreakdown]++;
    }

    if (Object.prototype.hasOwnProperty.call(typeBreakdown, type)) {
      typeBreakdown[type as keyof typeof typeBreakdown]++;
    }
  });

  return {
    totalServices,
    completedServices,
    totalCost,
    statusBreakdown,
    typeBreakdown
  };
});

// Helper functions
function mapServiceType(serviceType: string) {
  const typeMap: Record<string, string> = {
    "preventive_maintenance": "maintenance",
    "corrective_maintenance": "maintenance",
    "emergency_repair": "repair",
    "routine_repair": "repair",
    "safety_inspection": "inspection",
    "compliance_inspection": "inspection",
    "new_installation": "installation",
    "upgrade_installation": "installation",
    "maintenance": "maintenance",
    "repair": "repair",
    "inspection": "inspection",
    "installation": "installation"
  };
  return typeMap[serviceType] || "maintenance";
}

function mapServiceStatus(log: any) {
  if (log.status) return log.status;

  const now = Date.now();
  if (log.next_due_date && log.next_due_date < now) return "completed";
  if (log.service_date > now) return "scheduled";
  return "in-progress";
}

