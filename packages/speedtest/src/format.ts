/** Pick the largest time unit that fits a duration (or tick step). */
function pickTimeUnit(seconds: number): {
	unit: "s" | "m" | "h";
	divisor: number;
} {
	if (seconds >= 3600) return { unit: "h", divisor: 3600 };
	if (seconds >= 60) return { unit: "m", divisor: 60 };
	return { unit: "s", divisor: 1 };
}

/** Format a tick value as `Ns`, `Nm`, or `Nh` depending on the step size. */
export function formatTick(t: number, step: number): string {
	const { unit, divisor } = pickTimeUnit(step);
	const v = t / divisor;
	if (unit === "s") return `${v}s`;
	return `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;
}

/** `YY.XX` below 1000 Mbps, integer above. */
export function formatThroughput(mbits: number): string {
	return mbits >= 1000 ? mbits.toFixed(0) : mbits.toFixed(2);
}

/** Format a duration value-magnitude as `{value, unit}` so the summary can style the unit. */
export function formatDuration(seconds: number): {
	value: string;
	unit: string;
} {
	const { unit, divisor } = pickTimeUnit(seconds);
	const v = seconds / divisor;
	// Sub-minute always shows a decimal; m/h drop the trailing zero on whole numbers.
	if (unit === "s") return { value: v.toFixed(1), unit };
	return { value: Number.isInteger(v) ? String(v) : v.toFixed(1), unit };
}
