import type { SpeedtestResult } from "@repo/shared";

export interface ChartPoint {
	x: number;
	y: number;
	label: string;
}

export const HIT_RADIUS_PX = 12;

/** Candidate x-axis tick step sizes in seconds (1s, 2s, 5s, ..., 30m, 1h). */
const TICK_STEP_SECONDS = [
	1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

/** Round up a raw tick size (seconds) to the next friendly candidate. */
export function niceStep(raw: number): number {
	return (
		TICK_STEP_SECONDS.find((s) => s >= raw) ?? Math.ceil(raw / 3600) * 3600
	);
}

/** Round to the nearest `1/2/5 × 10^n` (Heckbert's nice numbers). */
export function niceRound(n: number): number {
	if (!Number.isFinite(n) || n <= 0) return 1;
	const mag = Math.pow(10, Math.floor(Math.log10(n)));
	const norm = n / mag;
	// Looks like magic but it works well
	const fraction = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
	return fraction * mag;
}

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

/** Convert speedtest intervals into chart points with hover labels. */
export function toChartSamples(
	intervals: SpeedtestResult["intervals"],
): ChartPoint[] {
	return intervals.map((iv) => ({
		x: iv.end_time_seconds,
		y: iv.throughput_mbits,
		label: `${formatThroughput(iv.throughput_mbits)} Mbps (${iv.start_time_seconds.toFixed(0)}\u2013${iv.end_time_seconds.toFixed(0)}s)`,
	}));
}

/** Nearest point to the cursor within a square hit box; null if out of range. */
export function findNearestDot(
	points: ChartPoint[],
	mx: number,
	my: number,
): ChartPoint | null {
	const best = findNearestByX(points, mx);
	if (!best) {
		return null;
	}
	return Math.abs(best.x - mx) < HIT_RADIUS_PX &&
		Math.abs(best.y - my) < HIT_RADIUS_PX
		? best
		: null;
}

/** Nearest point to the cursor, accepting any x within the average sample gap. */
export function findNearestOnLine(
	points: ChartPoint[],
	mx: number,
): ChartPoint | null {
	const best = findNearestByX(points, mx);
	if (!best) {
		return null;
	}
	const last = points.at(-1) ?? best;
	const avgGap =
		points.length > 1
			? (last.x - points[0].x) / (points.length - 1)
			: HIT_RADIUS_PX;
	return Math.abs(best.x - mx) < avgGap ? best : null;
}

/** Binary search for the point whose x is closest to `mx`. */
export function findNearestByX(
	points: ChartPoint[],
	mx: number,
): ChartPoint | null {
	if (points.length === 0) {
		return null;
	}
	let lo = 0;
	let hi = points.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (points[mid].x < mx) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	let best = points[lo];
	if (lo > 0 && Math.abs(points[lo - 1].x - mx) < Math.abs(best.x - mx)) {
		best = points[lo - 1];
	}
	return best;
}
