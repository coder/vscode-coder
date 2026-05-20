import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";

import { toError } from "../../error/errorUtils";
import {
	parseTelemetryEventLine,
	TelemetryFileParseError,
} from "../wireFormat";

import {
	fileDateCanContainRangeEvent,
	isTimestampInRange,
	type TelemetryDateRange,
} from "./range";

import type { TelemetryEvent } from "../event";

interface TelemetryLogFile {
	readonly path: string;
	readonly date: string;
	readonly session: string;
	readonly part: number;
}

/**
 * Filename shape written by the sink:
 * `telemetry-YYYY-MM-DD-{session}[.{part}].jsonl`. We need the date to filter
 * and (session, part) to order files within a day.
 */
const TELEMETRY_FILE_PATTERN =
	/^telemetry-(\d{4}-\d{2}-\d{2})-([^.]+)(?:\.(\d+))?\.jsonl$/;

/** Log files that could contain events in `range`, in chronological order. */
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
		.map((name) => parseLogFilename(telemetryDir, name))
		.filter(
			(file): file is TelemetryLogFile =>
				file !== undefined && fileDateCanContainRangeEvent(file.date, range),
		)
		.sort(compareLogFiles)
		.map(({ path: filePath }) => filePath);
}

/**
 * Yields events from `filePaths` in order, keeping only those whose timestamp
 * falls inside `range`. Reads line-by-line so memory stays flat on big files.
 */
export async function* streamTelemetryEvents(
	filePaths: readonly string[],
	range: TelemetryDateRange,
): AsyncIterable<TelemetryEvent> {
	for (const filePath of filePaths) {
		const name = path.basename(filePath);
		const stream = createReadStream(filePath, { encoding: "utf8" });
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

function parseLogFilename(
	dir: string,
	name: string,
): TelemetryLogFile | undefined {
	const match = TELEMETRY_FILE_PATTERN.exec(name);
	if (!match) {
		return undefined;
	}
	return {
		path: path.join(dir, name),
		date: match[1],
		session: match[2],
		part: match[3] === undefined ? 0 : Number(match[3]),
	};
}

function compareLogFiles(a: TelemetryLogFile, b: TelemetryLogFile): number {
	return (
		a.date.localeCompare(b.date) ||
		a.session.localeCompare(b.session) ||
		a.part - b.part
	);
}
