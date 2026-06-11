export type TriState = "yes" | "no" | "unknown";

const NANOS_PER_MS = 1_000_000;

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
	if (ms < 100) {
		return `${ms.toFixed(1)} ms`;
	}
	return `${Math.round(ms)} ms`;
}

export function formatTriState(
	value: TriState,
	labels: { yes: string; no: string },
): string {
	switch (value) {
		case "yes":
			return labels.yes;
		case "no":
			return labels.no;
		case "unknown":
			return "—";
	}
}
