import { z } from "zod";

/** Milliseconds in a 24-hour day. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Formats a Date as a UTC YYYY-MM-DD string. toISOString() returns
 * `YYYY-MM-DDTHH:mm:ss.sssZ` in UTC, so we take the date part before the "T".
 */
export function toUtcDateString(date: Date): string {
	return date.toISOString().split("T")[0];
}

const UtcDateSchema = z.iso.date();

/** User-facing error string if `value` isn't a UTC date, else `undefined`. */
export function validateUtcDateInput(value: string): string | undefined {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return "Use YYYY-MM-DD.";
	}
	return UtcDateSchema.safeParse(value).success
		? undefined
		: "Enter a valid calendar date.";
}

/** Parses a YYYY-MM-DD UTC date to epoch ms, throwing on invalid input. */
export function parseUtcDate(value: string): number {
	const error = validateUtcDateInput(value);
	if (error !== undefined) {
		throw new Error(`Invalid date '${value}': ${error}`);
	}
	const [y, m, d] = value.split("-").map(Number);
	return Date.UTC(y, m - 1, d);
}
