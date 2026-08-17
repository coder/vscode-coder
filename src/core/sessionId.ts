import { randomBytes } from "node:crypto";

/**
 * One session ID per extension host process, shared across logs, API
 * requests, telemetry, and the CLI so all data for a session can be correlated
 * by a single ID.
 *
 * In rare cases when the extension is deactivated then activated within the
 * same window, it should reuse the same ID. However, reloading or closing-
 * then-reopening a window creates a new process with a new ID.
 *
 * 16 bytes / 32 lowercase hex, matching the OTel id format so a future OTel
 * exporter maps 1:1. Avoids `vscode.env.sessionId`, which is a UUID
 * concatenated with a timestamp.
 */
export const sessionId = randomBytes(16).toString("hex");
