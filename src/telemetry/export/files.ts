import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";

import { toError } from "../../error/errorUtils";
import * as localJsonlFiles from "../localJsonlFiles";
import {
	parseTelemetryEventLine,
	TelemetryFileParseError,
} from "../wireFormat";

import {
	fileDateCanContainRangeEvent,
	isTimestampInRange,
	parseTelemetryTimestampMs,
	type TelemetryDateRange,
} from "./range";

import type { TelemetryEvent } from "../event";

interface TelemetryLogFile {
	readonly path: string;
	readonly date: string;
	readonly session: string;
	readonly part: number;
}

interface QueuedTelemetryEvent {
	readonly event: TelemetryEvent;
	readonly timestampMs: number;
}

interface EventCursor {
	readonly queued: QueuedTelemetryEvent;
	readonly iterator: AsyncIterator<TelemetryEvent>;
}

export interface TelemetryExportWarning {
	readonly code: "invalidTelemetryFilePath";
	readonly filePath: string;
	readonly error: Error;
}

export interface TelemetryExportWarningSink {
	readonly onWarning: (warning: TelemetryExportWarning) => void;
}

/** Log files whose dates could overlap `range`. */
export async function listTelemetryFilesForRange(
	telemetryDir: string,
	range: TelemetryDateRange,
): Promise<string[]> {
	let names: string[];
	try {
		names = await fs.readdir(telemetryDir);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw err;
	}

	return names
		.map((name) => parseLogFilePath(path.join(telemetryDir, name)))
		.filter(
			(file): file is TelemetryLogFile =>
				file !== undefined && fileDateCanContainRangeEvent(file.date, range),
		)
		.sort(compareLogFiles)
		.map(({ path: filePath }) => filePath);
}

/**
 * Merge range-filtered, per-session event streams by timestamp. This stays
 * globally sorted while each session's timestamps are monotonic; if a session's
 * clock moves backward, that session's append order is preserved.
 */
export async function* streamTelemetryEventsSorted(
	filePaths: readonly string[],
	range: TelemetryDateRange,
	warningSink: TelemetryExportWarningSink,
): AsyncIterable<TelemetryEvent> {
	const iterators: Array<AsyncIterator<TelemetryEvent>> = [];
	const frontier: EventCursor[] = [];
	try {
		await seedFrontier(frontier, iterators, filePaths, range, warningSink);
		while (frontier.length > 0) {
			const cursor = takeNextCursor(frontier);
			yield cursor.queued.event;
			await advanceCursor(frontier, cursor);
		}
	} finally {
		await closeIterators(iterators);
	}
}

async function* streamTelemetryEventsFromFiles(
	files: readonly TelemetryLogFile[],
	range: TelemetryDateRange,
): AsyncIterable<TelemetryEvent> {
	for (const file of files) {
		const name = path.basename(file.path);
		const stream = createReadStream(file.path, { encoding: "utf8" });
		const lines = readline.createInterface({
			input: stream,
			crlfDelay: Infinity,
		});
		let lineNumber = 0;
		try {
			for await (const line of lines) {
				lineNumber += 1;
				if (line.trim() === "") {
					continue;
				}
				const event = parseTelemetryEventLine(line, name, lineNumber);
				if (isTimestampInRange(event.timestamp, range)) {
					yield event;
				}
			}
		} catch (err) {
			if (err instanceof TelemetryFileParseError) {
				throw err;
			}
			const at = lineNumber > 0 ? `:${lineNumber}` : "";
			throw new Error(
				`Failed to read telemetry file ${name}${at}: ${toError(err).message}`,
				{ cause: err },
			);
		} finally {
			try {
				lines.close();
			} finally {
				stream.destroy();
			}
		}
	}
}

function groupFilesBySession(
	filePaths: readonly string[],
	warningSink: TelemetryExportWarningSink,
): TelemetryLogFile[][] {
	const files = parseLogFilePaths(filePaths, warningSink).sort(compareLogFiles);
	return [...Map.groupBy(files, (file) => file.session).values()];
}

function parseLogFilePaths(
	filePaths: readonly string[],
	warningSink: TelemetryExportWarningSink,
): TelemetryLogFile[] {
	const files: TelemetryLogFile[] = [];
	for (const filePath of filePaths) {
		const file = parseLogFilePath(filePath);
		if (!file) {
			emitWarning(warningSink, invalidTelemetryFilePathWarning(filePath));
			continue;
		}
		files.push(file);
	}
	return files;
}

function parseLogFilePath(filePath: string): TelemetryLogFile | undefined {
	const parsed = localJsonlFiles.parseFileName(path.basename(filePath));
	return parsed ? { path: filePath, ...parsed } : undefined;
}

function invalidTelemetryFilePathWarning(
	filePath: string,
): TelemetryExportWarning {
	return {
		code: "invalidTelemetryFilePath",
		filePath,
		error: new Error(`Invalid telemetry file path: ${path.basename(filePath)}`),
	};
}

function emitWarning(
	warningSink: TelemetryExportWarningSink,
	warning: TelemetryExportWarning,
): void {
	try {
		warningSink.onWarning(warning);
	} catch {
		// Warning observers must not fail the export.
	}
}

function compareLogFiles(a: TelemetryLogFile, b: TelemetryLogFile): number {
	return (
		a.date.localeCompare(b.date) ||
		a.session.localeCompare(b.session) ||
		a.part - b.part
	);
}

async function seedFrontier(
	frontier: EventCursor[],
	iterators: Array<AsyncIterator<TelemetryEvent>>,
	filePaths: readonly string[],
	range: TelemetryDateRange,
	warningSink: TelemetryExportWarningSink,
): Promise<void> {
	for (const files of groupFilesBySession(filePaths, warningSink)) {
		const iterator = streamTelemetryEventsFromFiles(files, range)[
			Symbol.asyncIterator
		]();
		iterators.push(iterator);
		await advanceCursor(frontier, { iterator });
	}
}

async function advanceCursor(
	frontier: EventCursor[],
	cursor: Pick<EventCursor, "iterator">,
): Promise<void> {
	const next = await cursor.iterator.next();
	if (!next.done) {
		frontier.push({
			queued: queueEvent(next.value),
			iterator: cursor.iterator,
		});
	}
}

async function closeIterators(
	iterators: ReadonlyArray<AsyncIterator<TelemetryEvent>>,
): Promise<void> {
	await Promise.allSettled(
		iterators.map(async (iterator) => {
			await iterator.return?.();
		}),
	);
}

function queueEvent(event: TelemetryEvent): QueuedTelemetryEvent {
	return { event, timestampMs: parseTelemetryTimestampMs(event.timestamp) };
}

function takeNextCursor(frontier: EventCursor[]): EventCursor {
	let nextIndex = 0;
	for (let i = 1; i < frontier.length; i += 1) {
		if (
			compareQueuedEvents(frontier[i].queued, frontier[nextIndex].queued) < 0
		) {
			nextIndex = i;
		}
	}
	const cursor = frontier[nextIndex];
	frontier.splice(nextIndex, 1);
	return cursor;
}

function compareQueuedEvents(
	a: QueuedTelemetryEvent,
	b: QueuedTelemetryEvent,
): number {
	return (
		a.timestampMs - b.timestampMs ||
		a.event.context.sessionId.localeCompare(b.event.context.sessionId)
	);
}
