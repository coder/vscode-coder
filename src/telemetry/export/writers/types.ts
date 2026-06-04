import type { TelemetryEvent } from "../../event";
import type { TelemetryDateRange } from "../range";

export type ExportFormat = "json" | "otlp";

/** Cancellation and best-effort cleanup hooks shared by every export writer. */
export interface ExportWriteOptions {
	readonly signal?: AbortSignal;
	/** A temp file or staging dir could not be removed (caller logs). */
	readonly onCleanupError?: (err: unknown, target: string) => void;
}

/** What an export covers. The OTLP writer records it in the zip's manifest. */
export interface ExportDescriptor {
	readonly range: TelemetryDateRange;
	readonly sourceFiles: number;
}

/** Streams `events` to `outputPath`, returning how many were written. */
export type ExportWriter = (
	outputPath: string,
	events: AsyncIterable<TelemetryEvent>,
	descriptor: ExportDescriptor,
	options?: ExportWriteOptions,
) => Promise<number>;
