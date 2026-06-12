import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";

import { toError } from "../../error/errorUtils";
import * as localJsonlFiles from "../localJsonlFiles";
import { TelemetryFileParser, TelemetryFileParseError } from "../wireFormat";

import {
	fileDateCanContainRangeEvent,
	isTimestampInRange,
	parseTelemetryTimestampMs,
	type TelemetryDateRange,
} from "./range";

import type { TelemetryEvent } from "../event";

export interface TelemetryLogFile {
	readonly path: string;
	readonly date: string;
	readonly session: string;
	readonly part: number;
}

interface EventCursor {
	readonly event: TelemetryEvent;
	readonly timestampMs: number;
	readonly iterator: AsyncIterator<TelemetryEvent>;
}

/** Log files whose dates could overlap `range`, in (date, session, part) order. */
export async function listTelemetryFilesForRange(
	telemetryDir: string,
	range: TelemetryDateRange,
): Promise<TelemetryLogFile[]> {
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
		.sort(compareLogFiles);
}

/**
 * Merge per-session event streams by timestamp, keeping only events whose
 * timestamp falls inside `range`. Output stays globally sorted while each
 * session's timestamps are monotonic; if a session's clock moves backward,
 * that session's append order is preserved. A file that cannot be read or
 * parsed is reported through `onFileError` and skipped from its first bad
 * line, so one bad file cannot sink an export.
 */
export async function* streamTelemetryEventsSorted(
	files: readonly TelemetryLogFile[],
	range: TelemetryDateRange,
	onFileError: (err: Error, fileName: string) => void,
): AsyncIterable<TelemetryEvent> {
	const iterators = groupFilesBySession(files).map((sessionFiles) =>
		streamTelemetryEventsFromFiles(sessionFiles, range, onFileError),
	);
	const frontier: EventCursor[] = [];
	try {
		for (const iterator of iterators) {
			await advanceCursor(frontier, iterator);
		}
		while (frontier.length > 0) {
			const cursor = takeNextCursor(frontier);
			yield cursor.event;
			await advanceCursor(frontier, cursor.iterator);
		}
	} finally {
		await closeIterators(iterators);
	}
}

async function* streamTelemetryEventsFromFiles(
	files: readonly TelemetryLogFile[],
	range: TelemetryDateRange,
	onFileError: (err: Error, fileName: string) => void,
): AsyncGenerator<TelemetryEvent> {
	for (const file of files) {
		const name = path.basename(file.path);
		const stream = createReadStream(file.path, { encoding: "utf8" });
		const lines = readline.createInterface({
			input: stream,
			crlfDelay: Infinity,
		});
		const parser = new TelemetryFileParser(name);
		let lineNumber = 0;
		try {
			for await (const line of lines) {
				lineNumber += 1;
				if (line.trim() === "") {
					continue;
				}
				const event = parser.parseLine(line, lineNumber);
				if (event && isTimestampInRange(event.timestamp, range)) {
					yield event;
				}
			}
		} catch (err) {
			const at = lineNumber > 0 ? `:${lineNumber}` : "";
			onFileError(
				err instanceof TelemetryFileParseError
					? err
					: new Error(
							`Failed to read telemetry file ${name}${at}: ${toError(err).message}`,
							{ cause: err },
						),
				name,
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
	files: readonly TelemetryLogFile[],
): TelemetryLogFile[][] {
	const sorted = [...files].sort(compareLogFiles);
	return [...Map.groupBy(sorted, (file) => file.session).values()];
}

function parseLogFilePath(filePath: string): TelemetryLogFile | undefined {
	const parsed = localJsonlFiles.parseFileName(path.basename(filePath));
	return parsed ? { path: filePath, ...parsed } : undefined;
}

function compareLogFiles(a: TelemetryLogFile, b: TelemetryLogFile): number {
	return (
		a.date.localeCompare(b.date) ||
		a.session.localeCompare(b.session) ||
		a.part - b.part
	);
}

async function advanceCursor(
	frontier: EventCursor[],
	iterator: AsyncIterator<TelemetryEvent>,
): Promise<void> {
	const next = await iterator.next();
	if (!next.done) {
		frontier.push({
			event: next.value,
			timestampMs: parseTelemetryTimestampMs(next.value.timestamp),
			iterator,
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

function takeNextCursor(frontier: EventCursor[]): EventCursor {
	let nextIndex = 0;
	for (let i = 1; i < frontier.length; i += 1) {
		if (compareCursors(frontier[i], frontier[nextIndex]) < 0) {
			nextIndex = i;
		}
	}
	const cursor = frontier[nextIndex];
	frontier.splice(nextIndex, 1);
	return cursor;
}

function compareCursors(a: EventCursor, b: EventCursor): number {
	return (
		a.timestampMs - b.timestampMs ||
		a.event.context.sessionId.localeCompare(b.event.context.sessionId)
	);
}
