import {
	ENVELOPES,
	type Signal,
} from "@/telemetry/export/writers/otlp/records";

import { createTelemetryEventFactory } from "../../../../../mocks/telemetry";

import type { TelemetryContext, TelemetryEvent } from "@/telemetry/event";

export const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** Realistic session context for golden-file fixtures (macOS arm64 session). */
export const GOLDEN_CONTEXT: TelemetryContext = {
	extensionVersion: "1.14.5",
	machineId: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
	sessionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
	osType: "Darwin",
	osVersion: "24.5.0",
	hostArch: "arm64",
	platformName: "Visual Studio Code",
	platformVersion: "1.96.2",
	deploymentUrl: "https://dev.coder.com",
};

/** W3C-format trace id (32 hex chars) for span golden fixtures. */
export const GOLDEN_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

const makeGoldenEvent = createTelemetryEventFactory();

const goldenEvent = (overrides: Partial<TelemetryEvent> = {}): TelemetryEvent =>
	makeGoldenEvent({ context: GOLDEN_CONTEXT, ...overrides });

/** A trace span event with `traceId` narrowed for `spanRecord`. */
const goldenSpan = (
	overrides: Partial<TelemetryEvent> = {},
): TelemetryEvent & { readonly traceId: string } => ({
	...goldenEvent({ traceId: GOLDEN_TRACE_ID, ...overrides }),
	traceId: GOLDEN_TRACE_ID,
});

/**
 * One representative export scenario, shared by the record-level and
 * envelope-level golden tests so both assert the same events. The writer test
 * feeds these straight through `writeOtlpZipExport`; the records test maps each
 * through `logRecord`/`spanRecord`/`metricRecords`.
 */
export const GOLDEN_EVENTS = {
	workspaceOpen: goldenEvent({
		eventName: "workspace.open",
		timestamp: "2026-05-04T18:12:03.412Z",
		properties: {
			workspace_owner: "developer",
			workspace_name: "frontend-dev",
			transport: "ssh",
		},
		measurements: { startup_ms: 842 },
	}),
	cliDownloadFailed: goldenEvent({
		eventName: "cli.download.failed",
		timestamp: "2026-05-04T18:12:04.118Z",
		properties: { source: "github-releases", version: "v2.18.1" },
		measurements: { retry_count: 3 },
		error: {
			message: "connect ECONNREFUSED 140.82.121.3:443",
			type: "FetchError",
			code: "ECONNREFUSED",
		},
	}),
	setupReady: goldenSpan({
		eventId: "00f067aa0ba902b7",
		eventName: "remote.setup.workspace_ready",
		timestamp: "2026-05-04T18:12:09.004Z",
		properties: { result: "success" },
		measurements: { durationMs: 8423, retries: 0 },
	}),
	sshConnect: goldenSpan({
		eventId: "b7ad6b7169203331",
		parentEventId: "00f067aa0ba902b7",
		eventName: "remote.ssh.connect",
		timestamp: "2026-05-04T18:12:12.560Z",
		properties: { result: "error", host: "coder.frontend-dev" },
		measurements: { durationMs: 3556, attempts: 4 },
		error: {
			message: "dial tcp 100.64.0.7:22: i/o timeout",
			type: "Error",
			code: "ETIMEDOUT",
		},
	}),
	httpRequests: goldenEvent({
		eventName: "http.requests",
		timestamp: "2026-05-04T18:13:00.000Z",
		properties: { method: "GET", route: "/api/v2/workspaces" },
		measurements: {
			window_seconds: 60,
			"count.2xx": 1280,
			"count.5xx": 3,
			"count.network_error": 1,
			"duration.p50_ms": 12,
			"duration.p95_ms": 88,
			"duration.p99_ms": 240,
		},
	}),
};

/** Flatten OTLP `[{key, value: {stringValue|doubleValue}}]` to `{key: value}`. */
export function attrs(raw: unknown): Record<string, string | number> {
	const list = raw as Array<{
		key: string;
		value: { stringValue?: string; doubleValue?: number };
	}>;
	return Object.fromEntries(
		list.map((a) => [a.key, a.value.doubleValue ?? a.value.stringValue!]),
	);
}

/** One resource block of an OTLP/JSON envelope. */
export interface ParsedBlock {
	resource: { attributes: unknown };
	schemaUrl: unknown;
	scope: { name: string; version: string };
	records: unknown[];
}

export interface ParsedEnvelope {
	blocks: ParsedBlock[];
	/** Records of all blocks, flattened in file order. */
	records: unknown[];
}

/** Decode and unwrap one OTLP/JSON envelope file from an unzipped bundle. */
export function parseEnvelope(
	files: Record<string, Uint8Array>,
	signal: Signal,
): ParsedEnvelope {
	const env = ENVELOPES[signal];
	type Rec = Record<string, unknown>;
	const json = JSON.parse(new TextDecoder().decode(files[env.file])) as Rec;
	const blocks = (json[env.resourceKey] as Rec[]).map((wrapper) => {
		const scopeWrapper = (wrapper[env.scopeKey] as Rec[])[0];
		return {
			resource: wrapper.resource as { attributes: unknown },
			schemaUrl: wrapper.schemaUrl,
			scope: scopeWrapper.scope as { name: string; version: string },
			records: scopeWrapper[env.recordsKey] as unknown[],
		};
	});
	return { blocks, records: blocks.flatMap((block) => block.records) };
}
