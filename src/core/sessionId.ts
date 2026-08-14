import { randomBytes } from "node:crypto";

/**
 * One session ID per activation, shared by logs, API requests, telemetry, and
 * the CLI so all data for a session can be correlated by a single ID.
 *
 * 16 bytes / 32 lowercase hex, matching the OTel id format so a future OTel
 * exporter maps 1:1. Avoids `vscode.env.sessionId`, which is a UUID
 * concatenated with a timestamp.
 */
export const sessionId = randomBytes(16).toString("hex");
