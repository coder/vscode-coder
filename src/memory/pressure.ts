import type { MemorySample } from "./usage";

/** PSI `some avg10` at or above this enters High. */
const PRESSURE_HIGH_PERCENT = 20;
/** PSI must be below this to leave High. */
const PRESSURE_CALM_PERCENT = 10;
/** Usage must drop this many points under the threshold to leave High. */
const EXIT_GAP_PERCENT = 5;
/** High usage needs this many of the last `USAGE_WINDOW` samples. */
const USAGE_HITS = 2;
const USAGE_WINDOW = 3;
/**
 * How long samples must stay calm to return to Normal. Time-based so polls
 * close together cannot clear a warning the user has not seen yet.
 */
const CALM_MS = 10_000;

export type MemoryState = "unavailable" | "normal" | "high";

/** What put memory in its current non-normal state. */
export type MemoryTrigger = "usage" | "pressure";

/** A state computed from a successful read. */
export interface MemoryReading {
	readonly state: Exclude<MemoryState, "unavailable">;
	readonly sample: MemorySample;
	/** Usage in percent of the limit, rounded like `coder stat mem`. */
	readonly percent: number;
	readonly trigger?: MemoryTrigger;
}

export type MemoryStatus = { readonly state: "unavailable" } | MemoryReading;

/**
 * Turns memory samples into a state with hysteresis, so a single spike does
 * not warn and usage hovering at the threshold does not flap.
 */
export class MemoryPressureTracker {
	private status: MemoryStatus = { state: "unavailable" };
	private recentHigh: boolean[] = [];
	private calmSince: number | undefined;
	private threshold: number | undefined;

	public constructor(private readonly now: () => number = Date.now) {}

	/** `threshold` is a percent of the limit; `0` turns warnings off. */
	public update(
		sample: MemorySample | undefined,
		threshold: number,
	): MemoryStatus {
		this.status = this.nextStatus(sample, threshold);
		return this.status;
	}

	private nextStatus(
		sample: MemorySample | undefined,
		threshold: number,
	): MemoryStatus {
		if (!sample || sample.totalBytes <= 0) {
			this.recentHigh = [];
			this.calmSince = undefined;
			return { state: "unavailable" };
		}
		if (threshold !== this.threshold) {
			this.threshold = threshold;
			this.recentHigh = [];
		}

		const percent = Math.round((sample.usedBytes / sample.totalBytes) * 100);
		const base = { sample, percent };
		if (threshold <= 0) {
			return { ...base, state: "normal" };
		}

		// Unknown pressure counts as none.
		const pressure = sample.pressure ?? 0;
		this.recentHigh = [...this.recentHigh, percent >= threshold].slice(
			-USAGE_WINDOW,
		);
		const calm =
			percent < threshold - EXIT_GAP_PERCENT &&
			pressure < PRESSURE_CALM_PERCENT;
		this.calmSince = calm ? (this.calmSince ?? this.now()) : undefined;

		const previous = this.status;
		if (isWarning(previous)) {
			return this.calmSince !== undefined &&
				this.now() - this.calmSince >= CALM_MS
				? { ...base, state: "normal" }
				: { ...base, state: previous.state, trigger: previous.trigger };
		}
		if (this.recentHigh.filter(Boolean).length >= USAGE_HITS) {
			return { ...base, state: "high", trigger: "usage" };
		}
		if (pressure >= PRESSURE_HIGH_PERCENT) {
			return { ...base, state: "high", trigger: "pressure" };
		}
		return { ...base, state: "normal" };
	}
}

export function isWarning(
	status: MemoryStatus,
): status is MemoryReading & { state: "high" } {
	return status.state === "high";
}
