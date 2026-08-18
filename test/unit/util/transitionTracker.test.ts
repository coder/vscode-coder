import { describe, expect, it } from "vitest";

import { TransitionTracker } from "@/util/transitionTracker";

describe("TransitionTracker", () => {
	const equals = (a: string, b: string) => a === b;

	it("reports `from: undefined` on the first observation", () => {
		const tracker = new TransitionTracker<string>(equals);

		expect(tracker.observe("a")).toEqual({ from: undefined });
	});

	it("returns undefined when the value is unchanged", () => {
		const tracker = new TransitionTracker<string>(equals);

		tracker.observe("a");

		expect(tracker.observe("a")).toBeUndefined();
	});

	it("returns the prior value when the value changes", () => {
		const tracker = new TransitionTracker<string>(equals);

		tracker.observe("a");

		expect(tracker.observe("b")).toEqual({ from: "a" });
	});

	it("tracks keys independently", () => {
		const tracker = new TransitionTracker<string>(equals);

		expect(tracker.observe("a", "k1")).toEqual({ from: undefined });
		expect(tracker.observe("b", "k2")).toEqual({ from: undefined });
		expect(tracker.observe("a", "k1")).toBeUndefined();
		expect(tracker.observe("c", "k2")).toEqual({ from: "b" });
	});

	it("forgets a single key on reset", () => {
		const tracker = new TransitionTracker<string>(equals);

		tracker.observe("a", "k1");
		tracker.reset("k1");

		expect(tracker.observe("a", "k1")).toEqual({ from: undefined });
	});

	it("forgets all keys on reset()", () => {
		const tracker = new TransitionTracker<string>(equals);

		tracker.observe("a", "k1");
		tracker.observe("b", "k2");
		tracker.reset();

		expect(tracker.observe("a", "k1")).toEqual({ from: undefined });
		expect(tracker.observe("b", "k2")).toEqual({ from: undefined });
	});
});
