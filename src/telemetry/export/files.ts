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

interface TelemetryEventEntry {
	readonly event: TelemetryEvent;
	readonly file: TelemetryLogFile;
	readonly lineNumber: number;
}

interface EventCursor {
	readonly entry: TelemetryEventEntry;
	readonly iterator: AsyncIterator<TelemetryEventEntry>;
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

/** Merge per-session append streams by timestamp, buffering one event per session. */
export async function* streamTelemetryEventsSorted(
	filePaths: readonly string[],
	range: TelemetryDateRange,
): AsyncIterable<TelemetryEvent> {
	const frontier: EventCursor[] = [];
	for (const files of sessionFileGroups(filePaths)) {
		const iterator = streamTelemetryEventEntries(files, range)[
			Symbol.asyncIterator
		]();
		const next = await iterator.next();
		if (!next.done) {
			frontier.push({ entry: next.value, iterator });
		}
	}

	while (frontier.length > 0) {
		frontier.sort((a, b) => compareEventEntries(a.entry, b.entry));
		const cursor = frontier.shift();
		if (!cursor) {
			return;
		}
		yield cursor.entry.event;

		const next = await cursor.iterator.next();
		if (!next.done) {
			frontier.push({ entry: next.value, iterator: cursor.iterator });
		}
	}
}

async function* streamTelemetryEventEntries(
	files: readonly TelemetryLogFile[],
	range: TelemetryDateRange,
): AsyncIterable<TelemetryEventEntry> {
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
					yield { event, file, lineNumber };
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

function sessionFileGroups(filePaths: readonly string[]): TelemetryLogFile[][] {
	const groups = new Map<string, TelemetryLogFile[]>();
	for (const file of parseLogFilePaths(filePaths).sort(compareLogFiles)) {
		const group = groups.get(file.session);
		if (group) {
			group.push(file);
		} else {
			groups.set(file.session, [file]);
		}
	}
	return [...groups.values()];
}

function parseLogFilePaths(filePaths: readonly string[]): TelemetryLogFile[] {
	return filePaths.flatMap((filePath) => {
		const file = parseLogFilePath(filePath);
		return file ? [file] : [];
	});
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

function compareEventEntries(
	a: TelemetryEventEntry,
	b: TelemetryEventEntry,
): number {
	const timestamp =
		parseTelemetryTimestampMs(a.event.timestamp) -
		parseTelemetryTimestampMs(b.event.timestamp);
	return (
		timestamp ||
		a.event.context.sessionId.localeCompare(b.event.context.sessionId)
	);
}
