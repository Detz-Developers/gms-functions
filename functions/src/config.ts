// src/config.ts
import { setGlobalOptions } from "firebase-functions/v2";
import "dotenv/config";

export const REGION = "us-central1";
export const DEFAULT_CPU = 0.25;

setGlobalOptions({
  region: REGION,
  cpu: DEFAULT_CPU
});
