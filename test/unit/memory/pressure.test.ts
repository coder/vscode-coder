import { describe, expect, it } from "vitest";

import { MemoryPressureTracker } from "@/memory/pressure";

import type { MemorySample } from "@/memory/usage";

/** `percent` used; `p` is PSI, `k` the OOM kill count of `counter`. */
function s(percent: number, p?: number, k = 0, counter = "a"): MemorySample {
	return {
		usedBytes: percent,
		totalBytes: 100,
		pressure: p,
		oomKills: { count: k, counter },
		source: "cgroup",
	};
}

describe("MemoryPressureTracker", () => {
	it.each([
		{
			name: "ignores a single spike",
			samples: [s(50), s(95), s(50), s(50)],
			states: ["normal", "normal", "normal", "normal"],
		},
		{
			name: "enters High when 2 of the last 3 samples reach the threshold",
			samples: [s(85), s(70), s(80)],
			states: ["normal", "normal", "high"],
		},
		{
			name: "stays High just under the threshold, leaves after 2 samples 5 points under",
			samples: [s(85), s(85), s(78), s(74), s(70)],
			states: ["normal", "high", "high", "high", "normal"],
		},
		{
			name: "enters High on pressure and leaves once it calms",
			samples: [s(40, 30), s(40, 12), s(40, 5), s(40, 5)],
			states: ["high", "high", "high", "normal"],
		},
		{
			name: "treats earlier OOM kills as the baseline and warns on a new one",
			samples: [s(30, undefined, 9), s(30, undefined, 9), s(30, undefined, 10)],
			states: ["normal", "normal", "processes_killed"],
		},
		{
			name: "starts a new OOM baseline when the counter changes",
			samples: [
				s(30, undefined, 1),
				s(30, undefined, 9, "b"),
				s(30, undefined, 10, "b"),
			],
			states: ["normal", "normal", "processes_killed"],
		},
		{
			name: "counts OOM kills that happened while readings were unavailable",
			samples: [s(30, undefined, 1), undefined, s(30, undefined, 2)],
			states: ["normal", "unavailable", "processes_killed"],
		},
		{
			name: "leaves Processes killed by the same calm rule",
			samples: [
				s(90, undefined, 0),
				s(90, undefined, 1),
				s(50, undefined, 1),
				s(50, undefined, 1),
			],
			states: ["normal", "processes_killed", "processes_killed", "normal"],
		},
		{
			name: "keeps a warning while calm samples arrive close together",
			gapMs: 500,
			samples: [
				s(90, undefined, 0),
				s(90, undefined, 1),
				s(50, undefined, 1),
				s(50, undefined, 1),
			],
			states: [
				"normal",
				"processes_killed",
				"processes_killed",
				"processes_killed",
			],
		},
		{
			name: "never warns with a threshold of 0",
			threshold: 0,
			samples: [s(99, 90, 0), s(99, 90, 4)],
			states: ["normal", "normal"],
		},
	])("$name", ({ samples, states, threshold = 80, gapMs = 10_000 }) => {
		let now = 0;
		const tracker = new MemoryPressureTracker(() => now);
		const actual = samples.map((x) => {
			now += gapMs;
			return tracker.update(x, threshold).state;
		});
		expect(actual).toEqual(states);
	});

	it("reports percent and trigger", () => {
		const tracker = new MemoryPressureTracker();
		expect(tracker.update(s(40, 25), 80)).toMatchObject({
			state: "high",
			trigger: "pressure",
			percent: 40,
		});
	});
});
