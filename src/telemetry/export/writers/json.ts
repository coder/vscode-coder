import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { writeAtomically } from "../../../util/fs";
import { serializeTelemetryEvent } from "../../wireFormat";

import type { TelemetryEvent } from "../../event";

import type { ExportWriteOptions } from "./types";

/**
 * Streams `events` as a JSON array to `outputPath` via a temp file and atomic
 * rename. Returns the number of events written; empty input writes a valid
 * `[]`. `options.signal` is unused (callers cancel upstream of the stream).
 */
export async function writeJsonArrayExport(
	outputPath: string,
	events: AsyncIterable<TelemetryEvent>,
	options: ExportWriteOptions = {},
): Promise<number> {
	let count = 0;
	async function* chunks(): AsyncGenerator<string> {
		yield "[";
		for await (const event of events) {
			yield (count === 0 ? "\n" : ",\n") +
				JSON.stringify(serializeTelemetryEvent(event));
			count += 1;
		}
		yield count === 0 ? "]\n" : "\n]\n";
	}
	await writeAtomically(
		outputPath,
		async (tempPath) => {
			await pipeline(
				Readable.from(chunks()),
				createWriteStream(tempPath, { encoding: "utf8" }),
			);
		},
		options.onCleanupError,
	);
	return count;
}
