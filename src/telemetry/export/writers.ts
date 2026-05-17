import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { renameWithRetry } from "../../util";

import { toStoredTelemetryEvent } from "./files";

import type { ExportTelemetryEvent } from "./types";

export interface ExportCounts {
	readonly events: number;
	readonly logs: number;
	readonly traces: number;
	readonly metrics: number;
}

class JsonEnvelopeWriter {
	readonly #filePath: string;
	readonly #suffix: string;
	#handle: fs.FileHandle | undefined;
	#count = 0;

	private constructor(filePath: string, suffix: string) {
		this.#filePath = filePath;
		this.#suffix = suffix;
	}

	public static async open(
		filePath: string,
		prefix: string,
		suffix: string,
	): Promise<JsonEnvelopeWriter> {
		const writer = new JsonEnvelopeWriter(filePath, suffix);
		writer.#handle = await fs.open(filePath, "w");
		try {
			await writer.#write(prefix);
			return writer;
		} catch (err) {
			await writer.close();
			throw err;
		}
	}

	public get count(): number {
		return this.#count;
	}

	public async write(value: unknown): Promise<void> {
		if (this.#count > 0) {
			await this.#write(",");
		}
		await this.#write(JSON.stringify(value));
		this.#count += 1;
	}

	public async close(): Promise<void> {
		if (!this.#handle) {
			return;
		}
		try {
			await this.#write(this.#suffix);
		} finally {
			await this.#handle.close();
			this.#handle = undefined;
		}
	}

	async #write(chunk: string): Promise<void> {
		if (!this.#handle) {
			throw new Error(`JSON writer for ${this.#filePath} is closed.`);
		}
		await this.#handle.writeFile(chunk, "utf8");
	}
}

export async function writeJsonArrayExport(
	outputPath: string,
	events: AsyncIterable<ExportTelemetryEvent>,
): Promise<ExportCounts> {
	return writeTempOutput(outputPath, async (tempPath) => {
		const writer = await JsonEnvelopeWriter.open(tempPath, "[\n", "\n]\n");
		let eventsWritten = 0;
		try {
			for await (const event of events) {
				await writer.write(toStoredTelemetryEvent(event));
				eventsWritten += 1;
			}
		} finally {
			await writer.close();
		}
		return {
			events: eventsWritten,
			logs: 0,
			traces: 0,
			metrics: 0,
		};
	});
}

async function writeTempOutput<T>(
	outputPath: string,
	write: (tempPath: string) => Promise<T>,
): Promise<T> {
	const parsed = path.parse(outputPath);
	const tempPath = path.join(
		parsed.dir,
		`.${parsed.name}.${process.pid}.${randomUUID()}.tmp${parsed.ext}`,
	);
	try {
		const result = await write(tempPath);
		await renameWithRetry(fs.rename, tempPath, outputPath);
		return result;
	} catch (err) {
		try {
			await fs.rm(tempPath, { force: true });
		} catch {
			// Keep the export failure as the error callers see.
		}
		throw err;
	}
}
