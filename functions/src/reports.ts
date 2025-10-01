import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as scheduler from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import { REGION } from "./config.js";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.database();

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set. Please add it to your environment.");
  }
  return apiKey;
}

async function callGemini(prompt: string): Promise<string> {
  try {
    const apiKey = getGeminiApiKey();
    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error("Gemini API returned a non-success status", {
        status: response.status,
        errorBody
      });
      return "Gemini API returned an error.";
    }

    const data = (await response.json()) as GeminiResponse;
    return (
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No content generated"
    );
  } catch (err) {
    logger.error("Error calling Gemini", err);
    if (err instanceof Error && err.message.includes("GEMINI_API_KEY")) {
      return "Gemini API key is not configured.";
    }
    return "Error occurred while generating report.";
  }
}

/**
 * Callable Function: Generate Report (on-demand from frontend)
 * request.data = { reportType: "summary" | "maintenance" }
 */
export const generateReport = onCall({ region: REGION }, async (request) => {
  const { reportType } = request.data || {};
  if (!reportType) {
    throw new HttpsError("invalid-argument", "reportType is required.");
  }

  const snapshot = await db.ref("/").once("value");
  const dbData = snapshot.val() || {};

  let inputData: Record<string, unknown>;
  let prompt: string;

  if (reportType === "summary") {
    inputData = {
      batteries: dbData.batteries || {},
      generators: dbData.generators || {},
      issues: dbData.issues ? Object.values(dbData.issues).slice(0, 10) : [],
      services: dbData.services ? Object.values(dbData.services).slice(0, 10) : [],
      tasks: dbData.tasks ? Object.values(dbData.tasks).slice(0, 10) : []
    };
    prompt = `Generate an AI Summary Report:\n${JSON.stringify(inputData, null, 2)}`;
  } else if (reportType === "maintenance") {
    inputData = {
      issues: dbData.issues || {},
      services: dbData.services || {},
      tasks: dbData.tasks || {}
    };
    prompt = `Generate a Maintenance & Issues Report:\n${JSON.stringify(inputData, null, 2)}`;
  } else {
    throw new HttpsError("invalid-argument", "Invalid reportType provided.");
  }

  const report = await callGemini(prompt);

  const now = Date.now();
  const reportRef = db.ref("reports").push();
  await reportRef.set({
    type: reportType,
    content: report,
    createdAt: now
  });

  return { ok: true, report, id: reportRef.key };
});

/**
 * Scheduled function: AI Summary Report (runs automatically every 24h)
 */
export const aiSummaryReport = scheduler.onSchedule(
  { schedule: "every 24 hours", region: REGION },
  async () => {
    const snapshot = await db.ref("/").once("value");
    const dbData = snapshot.val() || {};

    const inputData = {
      batteries: dbData.batteries || {},
      generators: dbData.generators || {},
      issues: dbData.issues ? Object.values(dbData.issues).slice(0, 10) : [],
      services: dbData.services ? Object.values(dbData.services).slice(0, 10) : [],
      tasks: dbData.tasks ? Object.values(dbData.tasks).slice(0, 10) : []
    };

    const prompt = `Generate an AI Summary Report:\n${JSON.stringify(inputData, null, 2)}`;
    const report = await callGemini(prompt);

    await db.ref("reports").push({
      type: "summary",
      content: report,
      createdAt: Date.now()
    });

    logger.info("Scheduled AI Summary Report generated.");
  }
);

/**
 * Scheduled function: AI Maintenance Report (runs automatically every 24h)
 */
export const aiMaintenanceReport = scheduler.onSchedule(
  { schedule: "every 24 hours", region: REGION },
  async () => {
    const snapshot = await db.ref("/").once("value");
    const dbData = snapshot.val() || {};

    const inputData = {
      issues: dbData.issues || {},
      services: dbData.services || {},
      tasks: dbData.tasks || {}
    };

    const prompt = `Generate a Maintenance & Issues Report:\n${JSON.stringify(inputData, null, 2)}`;
    const report = await callGemini(prompt);

    await db.ref("reports").push({
      type: "maintenance",
      content: report,
      createdAt: Date.now()
    });

    logger.info("Scheduled AI Maintenance Report generated.");
  }
);
