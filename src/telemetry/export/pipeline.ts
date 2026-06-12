import * as fs from "node:fs/promises";

import { throwIfAborted } from "../../error/errorUtils";

import {
	listTelemetryFilesForRange,
	streamTelemetryEventsSorted,
} from "./files";

import type { TelemetryEvent } from "../event";
import type { FlushStatus } from "../service";

import type { TelemetryDateRange } from "./range";
import type { ExportWriter } from "./writers/types";

export interface ExportRequest {
	readonly telemetryDir: string;
	readonly range: TelemetryDateRange;
	readonly outputPath: string;
	readonly writer: ExportWriter;
}

/**
 * Host hooks the export needs: cancellation, flush, progress, and a cleanup
 * callback. Free of VS Code types so the pipeline is testable without a UI.
 */
export interface ExportRuntime {
	readonly signal: AbortSignal;
	readonly flushTelemetry: () => Promise<FlushStatus>;
	readonly report: (message: string) => void;
	/** The pre-export flush did not fully succeed, so recent events may be missing. */
	readonly onFlushIncomplete: () => void;
	/** A temp file, staging dir, or empty export could not be removed (caller logs). */
	readonly onCleanupError: (err: unknown, target: string) => void;
}

/**
 * Flushes telemetry, then streams every event in the range to `outputPath`.
 * Returns the number written; an export matching nothing leaves no file
 * behind. Throws on cancellation or write failure.
 */
export async function collectTelemetryExport(
	request: ExportRequest,
	runtime: ExportRuntime,
): Promise<number> {
	runtime.report("Flushing buffered events...");
	const flushStatus = await runtime.flushTelemetry();
	throwIfAborted(runtime.signal);
	if (!flushStatus.ok) {
		runtime.onFlushIncomplete();
	}

	runtime.report("Locating telemetry files...");
	const files = await listTelemetryFilesForRange(
		request.telemetryDir,
		request.range,
	);
	if (files.length === 0) {
		return 0;
	}

	runtime.report("Writing export...");
	const events = abortable(
		streamTelemetryEventsSorted(files, request.range),
		runtime.signal,
	);
	const eventCount = await request.writer(
		request.outputPath,
		events,
		{ range: request.range, sourceFiles: files.length },
		{ signal: runtime.signal, onCleanupError: runtime.onCleanupError },
	);
	if (eventCount === 0) {
		await removeEmptyExport(request.outputPath, runtime.onCleanupError);
	}
	return eventCount;
}

/** Removes the file a writer produced for an export that matched no events. */
async function removeEmptyExport(
	outputPath: string,
	onCleanupError: (err: unknown, target: string) => void,
): Promise<void> {
	try {
		await fs.rm(outputPath, { force: true });
	} catch (err) {
		onCleanupError(err, outputPath);
	}
}

/** Re-yields `events`, checking for cancellation before each one. */
async function* abortable(
	events: AsyncIterable<TelemetryEvent>,
	signal: AbortSignal,
): AsyncIterable<TelemetryEvent> {
	for await (const event of events) {
		throwIfAborted(signal);
		yield event;
	}
}
