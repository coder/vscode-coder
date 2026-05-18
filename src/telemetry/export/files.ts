import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { z } from "zod";

import {
	fileDateCanContainRangeEvent,
	isTimestampInRange,
	type TelemetryDateRange,
} from "./range";

import type { TelemetryEvent } from "../event";

const TELEMETRY_FILE_PATTERN =
	/^telemetry-(\d{4}-\d{2}-\d{2})-([a-zA-Z0-9]+)(?:\.(\d+))?\.jsonl$/;

const StoredTelemetryEventSchema = z.object({
	event_id: z.string(),
	event_name: z.string(),
	timestamp: z.iso.datetime({ offset: true }),
	event_sequence: z.number().finite(),
	context: z.object({
		extension_version: z.string(),
		machine_id: z.string(),
		session_id: z.string(),
		os_type: z.string(),
		os_version: z.string(),
		host_arch: z.string(),
		platform_name: z.string(),
		platform_version: z.string(),
		deployment_url: z.string(),
	}),
	properties: z.record(z.string(), z.string()),
	measurements: z.record(z.string(), z.number().finite()),
	trace_id: z.string().optional(),
	parent_event_id: z.string().optional(),
	error: z
		.object({
			message: z.string(),
			type: z.string().optional(),
			code: z.string().optional(),
		})
		.optional(),
});

const TelemetryEventSchema = StoredTelemetryEventSchema.transform(
	(event): TelemetryEvent => ({
		eventId: event.event_id,
		eventName: event.event_name,
		timestamp: event.timestamp,
		eventSequence: event.event_sequence,
		context: {
			extensionVersion: event.context.extension_version,
			machineId: event.context.machine_id,
			sessionId: event.context.session_id,
			osType: event.context.os_type,
			osVersion: event.context.os_version,
			hostArch: event.context.host_arch,
			platformName: event.context.platform_name,
			platformVersion: event.context.platform_version,
			deploymentUrl: event.context.deployment_url,
		},
		properties: event.properties,
		measurements: event.measurements,
		...(event.trace_id !== undefined && { traceId: event.trace_id }),
		...(event.parent_event_id !== undefined && {
			parentEventId: event.parent_event_id,
		}),
		...(event.error !== undefined && { error: event.error }),
	}),
);

type StoredTelemetryEvent = z.infer<typeof StoredTelemetryEventSchema>;

interface TelemetryFileCandidate {
	readonly name: string;
	readonly date: string;
	readonly sessionSlug: string;
	readonly segment: number;
}

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
		.map((name) => telemetryFileCandidate(name))
		.filter(
			(candidate): candidate is TelemetryFileCandidate =>
				candidate !== undefined &&
				fileDateCanContainRangeEvent(candidate.date, range),
		)
		.sort(compareTelemetryFiles)
		.map(({ name }) => path.join(telemetryDir, name));
}

function telemetryFileCandidate(
	name: string,
): TelemetryFileCandidate | undefined {
	const match = TELEMETRY_FILE_PATTERN.exec(name);
	if (!match) {
		return undefined;
	}
	return {
		name,
		date: match[1],
		sessionSlug: match[2],
		segment: match[3] === undefined ? 0 : Number(match[3]),
	};
}

function compareTelemetryFiles(
	a: TelemetryFileCandidate,
	b: TelemetryFileCandidate,
): number {
	return (
		a.date.localeCompare(b.date) ||
		a.sessionSlug.localeCompare(b.sessionSlug) ||
		a.segment - b.segment ||
		a.name.localeCompare(b.name)
	);
}

export async function* readTelemetryEvents(
	filePaths: readonly string[],
	range: TelemetryDateRange,
): AsyncGenerator<TelemetryEvent> {
	for (const filePath of filePaths) {
		let lineNumber = 0;
		const lines = readline.createInterface({
			input: createReadStream(filePath, { encoding: "utf8" }),
			crlfDelay: Infinity,
		});
		try {
			for await (const line of lines) {
				lineNumber += 1;
				if (line.trim() === "") {
					continue;
				}
				const event = parseStoredTelemetryEvent(line, filePath, lineNumber);
				if (isTimestampInRange(event.timestamp, range)) {
					yield event;
				}
			}
		} catch (err) {
			throw wrapReadError(err, filePath, lineNumber);
		}
	}
}

export function parseStoredTelemetryEvent(
	line: string,
	filePath = "<telemetry>",
	lineNumber = 1,
): TelemetryEvent {
	try {
		return TelemetryEventSchema.parse(JSON.parse(line));
	} catch (err) {
		throw new Error(
			`Failed to parse telemetry file ${path.basename(filePath)}:${lineNumber}: ${errorMessage(err)}`,
			{ cause: err },
		);
	}
}

export function toStoredTelemetryEvent(
	event: TelemetryEvent,
): StoredTelemetryEvent {
	return {
		event_id: event.eventId,
		event_name: event.eventName,
		timestamp: event.timestamp,
		event_sequence: event.eventSequence,
		context: {
			extension_version: event.context.extensionVersion,
			machine_id: event.context.machineId,
			session_id: event.context.sessionId,
			os_type: event.context.osType,
			os_version: event.context.osVersion,
			host_arch: event.context.hostArch,
			platform_name: event.context.platformName,
			platform_version: event.context.platformVersion,
			deployment_url: event.context.deploymentUrl,
		},
		properties: event.properties,
		measurements: event.measurements,
		...(event.traceId !== undefined && { trace_id: event.traceId }),
		...(event.parentEventId !== undefined && {
			parent_event_id: event.parentEventId,
		}),
		...(event.error !== undefined && { error: event.error }),
	};
}

function wrapReadError(
	err: unknown,
	filePath: string,
	lineNumber: number,
): Error {
	if (err instanceof Error && err.message.includes(path.basename(filePath))) {
		return err;
	}
	const location = lineNumber > 0 ? `:${lineNumber}` : "";
	return new Error(
		`Failed to read telemetry file ${path.basename(filePath)}${location}: ${errorMessage(err)}`,
		{ cause: err },
	);
}

function errorMessage(err: unknown): string {
	if (err instanceof z.ZodError) {
		return z.prettifyError(err);
	}
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}
