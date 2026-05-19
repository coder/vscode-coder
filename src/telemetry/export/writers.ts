import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { writeAtomically } from "../../util/fs";
import { serializeTelemetryEvent } from "../wireFormat";

import type { TelemetryEvent } from "../event";

/**
 * Writes `events` as a JSON array to `outputPath` via a temp file + atomic
 * rename, so a partial write never replaces the destination. Streams chunks
 * with backpressure so memory stays flat even for large exports.
 * Returns the number of events written.
 */
export async function writeJsonArrayExport(
	outputPath: string,
	events: AsyncIterable<TelemetryEvent>,
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
	await writeAtomically(outputPath, async (tempPath) => {
		await pipeline(
			Readable.from(chunks()),
			createWriteStream(tempPath, { encoding: "utf8" }),
		);
	});
	return count;
}
