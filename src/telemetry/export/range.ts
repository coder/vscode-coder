import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;
const UtcDateSchema = z.iso.date();

export type TelemetryRangePresetId =
	| "last24Hours"
	| "last7Days"
	| "last30Days"
	| "allTime";

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

export const TELEMETRY_RANGE_PRESETS: readonly TelemetryRangePreset[] = [
	{
		id: "last24Hours",
		label: "Last 24 hours",
		detail: "Export telemetry from the last day.",
	},
	{
		id: "last7Days",
		label: "Last 7 days",
		detail: "Export telemetry from the last week.",
	},
	{
		id: "last30Days",
		label: "Last 30 days",
		detail: "Export telemetry from the last month.",
	},
	{
		id: "allTime",
		label: "All time",
		detail: "Export all stored telemetry.",
	},
];

export function createPresetDateRange(
	id: TelemetryRangePresetId,
	now: Date = new Date(),
): TelemetryDateRange {
	const endMs = now.getTime();
	switch (id) {
		case "last24Hours":
			return {
				label: "Last 24 hours",
				filenamePart: "last-24-hours",
				startMs: endMs - DAY_MS,
				endMs,
			};
		case "last7Days":
			return {
				label: "Last 7 days",
				filenamePart: "last-7-days",
				startMs: endMs - 7 * DAY_MS,
				endMs,
			};
		case "last30Days":
			return {
				label: "Last 30 days",
				filenamePart: "last-30-days",
				startMs: endMs - 30 * DAY_MS,
				endMs,
			};
		case "allTime":
			return {
				label: "All time",
				filenamePart: "all-time",
			};
	}
}

export function createCustomDateRange(
	startDate: string,
	endDate: string,
): TelemetryDateRange {
	const startMs = parseUtcDate(startDate);
	const endStartMs = parseUtcDate(endDate);
	if (endStartMs < startMs) {
		throw new Error("End date must be on or after start date.");
	}
	return {
		label: `${startDate} to ${endDate}`,
		filenamePart: `${startDate}_to_${endDate}`,
		startMs,
		endMs: endStartMs + DAY_MS,
	};
}

export function validateUtcDateInput(value: string): string | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return "Use YYYY-MM-DD.";
	}
	return UtcDateSchema.safeParse(value).success
		? undefined
		: "Enter a valid calendar date.";
}

export function parseUtcDate(value: string): number {
	try {
		const [year, month, day] = UtcDateSchema.parse(value)
			.split("-")
			.map(Number);
		return Date.UTC(year, month - 1, day);
	} catch (err) {
		throw new Error(`Invalid date '${value}'. Use YYYY-MM-DD.`, { cause: err });
	}
}

export function utcDateString(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export function isTimestampInRange(
	timestamp: string,
	range: TelemetryDateRange,
): boolean {
	const ms = Date.parse(timestamp);
	if (!Number.isFinite(ms)) {
		throw new Error(`Invalid telemetry timestamp '${timestamp}'.`);
	}
	return (
		(range.startMs === undefined || ms >= range.startMs) &&
		(range.endMs === undefined || ms < range.endMs)
	);
}

export function fileDateCanContainRangeEvent(
	date: string,
	range: TelemetryDateRange,
): boolean {
	if (range.startMs === undefined && range.endMs === undefined) {
		return true;
	}
	const startDate =
		range.startMs === undefined ? undefined : utcDateString(range.startMs);
	const endDate =
		range.endMs === undefined
			? undefined
			: utcDateString(range.endMs - 1 + DAY_MS);
	return (
		(startDate === undefined || date >= startDate) &&
		(endDate === undefined || date <= endDate)
	);
}
