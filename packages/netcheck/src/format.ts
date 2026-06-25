export type TriState = "yes" | "no" | "unknown";

const NANOS_PER_MS = 1_000_000;

/** Below this, show one decimal; at or above, round to whole ms. */
const DECIMAL_PRECISION_BELOW_MS = 100;

export function nanosToMs(nanos: number): number {
	return nanos / NANOS_PER_MS;
}

export function formatLatency(ms: number | undefined): string {
	if (ms === undefined) {
		return "—";
	}
	if (ms < 1) {
		return "<1 ms";
	}
	if (ms < DECIMAL_PRECISION_BELOW_MS) {
		return `${ms.toFixed(1)} ms`;
	}
	return `${Math.round(ms)} ms`;
}

/** Renders a STUN/relay capability result for a table cell. */
export function formatTriState(value: TriState): string {
	switch (value) {
		case "yes":
			return "Yes";
		case "no":
			return "Failed";
		case "unknown":
			return "—";
	}
}
