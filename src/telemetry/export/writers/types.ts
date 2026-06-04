import type { TelemetryEvent } from "../../event";

export type ExportFormat = "json" | "otlp";

/** Cancellation and best-effort cleanup hooks shared by every export writer. */
export interface ExportWriteOptions {
	readonly signal?: AbortSignal;
	/** A temp file or staging dir could not be removed (caller logs). */
	readonly onCleanupError?: (err: unknown, target: string) => void;
}

/** Streams `events` to `outputPath`, returning how many were written. */
export type ExportWriter = (
	outputPath: string,
	events: AsyncIterable<TelemetryEvent>,
	options: ExportWriteOptions,
) => Promise<number>;
