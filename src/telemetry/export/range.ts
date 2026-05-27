import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;
const UtcDateSchema = z.iso.date();

/**
 * Half-open UTC window `[startMs, endMs)` used to filter telemetry. Either
 * bound may be `undefined` (e.g. "all time"). `label` is for the UI and
 * `filenamePart` is for export filenames.
 */
export interface TelemetryDateRange {
	readonly label: string;
	readonly filenamePart: string;
	readonly startMs?: number;
	readonly endMs?: number;
}

export interface TelemetryRangePreset {
	readonly id: TelemetryRangePresetId;
	readonly label: string;
	readonly detail: string;
}

export type TelemetryRangePresetId = keyof typeof PRESETS;

const PRESETS = {
	last24Hours: {
		label: "Last 24 hours",
		detail: "Export telemetry from the last day.",
		filenamePart: "last-24-hours",
		durationMs: DAY_MS,
	},
	last7Days: {
		label: "Last 7 days",
		detail: "Export telemetry from the last week.",
		filenamePart: "last-7-days",
		durationMs: 7 * DAY_MS,
	},
	last30Days: {
		label: "Last 30 days",
		detail: "Export telemetry from the last month.",
		filenamePart: "last-30-days",
		durationMs: 30 * DAY_MS,
	},
	allTime: {
		label: "All time",
		detail: "Export all stored telemetry.",
		filenamePart: "all-time",
		durationMs: undefined,
	},
} as const;

/** Presets the export UI shows, in display order. */
export const TELEMETRY_RANGE_PRESETS: readonly TelemetryRangePreset[] =
	Object.entries(PRESETS).map(([id, p]) => ({
		id: id as TelemetryRangePresetId,
		label: p.label,
		detail: p.detail,
	}));

/** Range from a preset id, anchored at `now`. */
export function createPresetDateRange(
	id: TelemetryRangePresetId,
	now: Date = new Date(),
): TelemetryDateRange {
	const { label, filenamePart, durationMs } = PRESETS[id];
	if (durationMs === undefined) {
		return { label, filenamePart };
	}
	const endMs = now.getTime();
	return { label, filenamePart, startMs: endMs - durationMs, endMs };
}

/**
 * UTC range that includes the full 24h of `endDate`; `endMs` lands at
 * exclusive midnight of the day after.
 */
export function createCustomDateRange(
	startDate: string,
	endDate: string,
): TelemetryDateRange {
	const startDateMs = parseUtcDate(startDate);
	const endDateMs = parseUtcDate(endDate);
	if (endDateMs < startDateMs) {
		throw new Error("End date must be on or after start date.");
	}
	return {
		label: `${startDate} to ${endDate}`,
		filenamePart: `${startDate}_to_${endDate}`,
		startMs: startDateMs,
		endMs: endDateMs + DAY_MS,
	};
}

/** User-facing error string if `value` isn't a UTC date, else `undefined`. */
export function validateUtcDateInput(value: string): string | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return "Use YYYY-MM-DD.";
	}
	return UtcDateSchema.safeParse(value).success
		? undefined
		: "Enter a valid calendar date.";
}

/** Parses a telemetry ISO timestamp to epoch ms, throwing on unparseable input. */
export function parseTelemetryTimestampMs(timestamp: string): number {
	const ms = Date.parse(timestamp);
	if (!Number.isFinite(ms)) {
		throw new Error(`Invalid telemetry timestamp '${timestamp}'.`);
	}
	return ms;
}

/** True if the ISO `timestamp` falls inside the range. */
export function isTimestampInRange(
	timestamp: string,
	range: TelemetryDateRange,
): boolean {
	const ms = parseTelemetryTimestampMs(timestamp);
	return (
		(range.startMs === undefined || ms >= range.startMs) &&
		(range.endMs === undefined || ms < range.endMs)
	);
}

/**
 * Coarse calendar-day filter: could a file dated `date` (YYYY-MM-DD) hold any
 * event in `range`? Lets us skip files without reading them.
 */
export function fileDateCanContainRangeEvent(
	date: string,
	range: TelemetryDateRange,
): boolean {
	const startDate =
		range.startMs === undefined ? undefined : utcDateString(range.startMs);
	const endDate =
		range.endMs === undefined ? undefined : utcDateString(range.endMs - 1);
	return (
		(startDate === undefined || date >= startDate) &&
		(endDate === undefined || date <= endDate)
	);
}

function parseUtcDate(value: string): number {
	const error = validateUtcDateInput(value);
	if (error !== undefined) {
		throw new Error(`Invalid date '${value}': ${error}`);
	}
	const [y, m, d] = value.split("-").map(Number);
	return Date.UTC(y, m - 1, d);
}

function utcDateString(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}
