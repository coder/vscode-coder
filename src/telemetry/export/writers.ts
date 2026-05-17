import { Zip, ZipPassThrough } from "fflate";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { renameWithRetry } from "../../util";

import { toStoredTelemetryEvent } from "./files";
import {
	isMetricEvent,
	toOtlpLogResource,
	toOtlpMetricResource,
	toOtlpSpanResource,
} from "./otlp";

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
			await writer.#handle.close();
			writer.#handle = undefined;
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

export async function writeOtlpZipExport(
	outputPath: string,
	events: AsyncIterable<ExportTelemetryEvent>,
): Promise<ExportCounts> {
	return writeTempOutput(outputPath, async (tempPath) => {
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "coder-telemetry-export-"),
		);
		try {
			const counts = await writeOtlpJsonFiles(tempDir, events);
			await writeZip(tempPath, [
				{ name: "logs.json", filePath: path.join(tempDir, "logs.json") },
				{ name: "traces.json", filePath: path.join(tempDir, "traces.json") },
				{ name: "metrics.json", filePath: path.join(tempDir, "metrics.json") },
			]);
			return counts;
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
}

async function writeOtlpJsonFiles(
	tempDir: string,
	events: AsyncIterable<ExportTelemetryEvent>,
): Promise<ExportCounts> {
	const writers = await openOtlpWriters(tempDir);
	let eventCount = 0;
	try {
		for await (const event of events) {
			eventCount += 1;
			if (isMetricEvent(event)) {
				await writers.metrics.write(toOtlpMetricResource(event));
			} else if (event.traceId !== undefined) {
				await writers.traces.write(toOtlpSpanResource(event));
			} else {
				await writers.logs.write(toOtlpLogResource(event));
			}
		}
	} finally {
		await Promise.all([
			writers.logs.close(),
			writers.traces.close(),
			writers.metrics.close(),
		]);
	}

	return {
		events: eventCount,
		logs: writers.logs.count,
		traces: writers.traces.count,
		metrics: writers.metrics.count,
	};
}

async function openOtlpWriters(tempDir: string): Promise<{
	readonly logs: JsonEnvelopeWriter;
	readonly traces: JsonEnvelopeWriter;
	readonly metrics: JsonEnvelopeWriter;
}> {
	const opened: JsonEnvelopeWriter[] = [];
	try {
		const logs = await JsonEnvelopeWriter.open(
			path.join(tempDir, "logs.json"),
			'{"resourceLogs":[',
			"]}\n",
		);
		opened.push(logs);
		const traces = await JsonEnvelopeWriter.open(
			path.join(tempDir, "traces.json"),
			'{"resourceSpans":[',
			"]}\n",
		);
		opened.push(traces);
		const metrics = await JsonEnvelopeWriter.open(
			path.join(tempDir, "metrics.json"),
			'{"resourceMetrics":[',
			"]}\n",
		);
		return { logs, traces, metrics };
	} catch (err) {
		await Promise.allSettled(opened.map((writer) => writer.close()));
		throw err;
	}
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

async function writeZip(
	outputPath: string,
	entries: ReadonlyArray<{ readonly name: string; readonly filePath: string }>,
): Promise<void> {
	const handle = await fs.open(outputPath, "w");
	let writeChain = Promise.resolve();
	let rejectZip: (err: unknown) => void = () => undefined;
	let resolveZip: () => void = () => undefined;
	const done = new Promise<void>((resolve, reject) => {
		resolveZip = resolve;
		rejectZip = reject;
	});
	const zip = new Zip((err, chunk, final) => {
		if (err) {
			rejectZip(err);
			return;
		}
		if (chunk) {
			writeChain = writeChain.then(() => handle.writeFile(chunk));
		}
		if (final) {
			writeChain.then(resolveZip, rejectZip);
		}
	});

	try {
		for (const entry of entries) {
			await addZipEntry(zip, entry.name, entry.filePath, () => writeChain);
		}
		zip.end();
		await done;
	} finally {
		zip.terminate();
		try {
			await writeChain;
		} catch {
			// Preserve the original zip/read error when there is one.
		}
		await handle.close();
	}
}

async function addZipEntry(
	zip: Zip,
	name: string,
	filePath: string,
	pendingWrites: () => Promise<void>,
): Promise<void> {
	const entry = new ZipPassThrough(name);
	zip.add(entry);
	for await (const chunk of createReadStream(filePath)) {
		entry.push(toUint8Array(chunk));
		await pendingWrites();
	}
	entry.push(new Uint8Array(), true);
	await pendingWrites();
}

function toUint8Array(chunk: unknown): Uint8Array {
	if (typeof chunk === "string") {
		return new TextEncoder().encode(chunk);
	}
	if (Buffer.isBuffer(chunk)) {
		return chunk;
	}
	throw new Error("Unexpected zip entry chunk type.");
}
