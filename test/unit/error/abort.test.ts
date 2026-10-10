import { describe, expect, it } from "vitest";

import { isAbortError, raceWithAbort } from "@/error/abort";

describe("isAbortError", () => {
	it("returns true for an Error named AbortError", () => {
		const err = new Error("aborted");
		err.name = "AbortError";
		expect(isAbortError(err)).toBe(true);
	});

	it("returns true for DOMException-style abort thrown by AbortController", () => {
		const ac = new AbortController();
		ac.abort();
		// `signal.reason` is a DOMException with name "AbortError" in modern Node.
		const reason = ac.signal.reason;
		expect(isAbortError(reason)).toBe(true);
	});

	it("returns false for a plain Error", () => {
		expect(isAbortError(new Error("nope"))).toBe(false);
	});

	it.each<[string, unknown]>([
		["null", null],
		["undefined", undefined],
		["string", "AbortError"],
		["object with name only", { name: "AbortError" }],
	])("returns false for %s", (_name, input) => {
		expect(isAbortError(input)).toBe(false);
	});

	it("narrows the type to Error", () => {
		const err: unknown = Object.assign(new Error("aborted"), {
			name: "AbortError",
		});
		if (isAbortError(err)) {
			// Type-only assertion: this line must compile without a cast.
			expect(err.message).toBe("aborted");
		} else {
			throw new Error("expected isAbortError to narrow");
		}
	});
});

describe("raceWithAbort", () => {
	it("resolves with the promise result when not aborted", async () => {
		const ac = new AbortController();
		await expect(
			raceWithAbort(Promise.resolve("done"), ac.signal),
		).resolves.toBe("done");
	});

	it("rejects with an AbortError when the signal aborts first", async () => {
		const ac = new AbortController();
		const hanging = new Promise<never>(() => {});
		const raced = raceWithAbort(hanging, ac.signal);
		ac.abort();
		await expect(raced).rejects.toSatisfy(isAbortError);
	});

	it("rejects immediately when the signal is already aborted", async () => {
		const ac = new AbortController();
		ac.abort();
		const hanging = new Promise<never>(() => {});
		await expect(raceWithAbort(hanging, ac.signal)).rejects.toSatisfy(
			isAbortError,
		);
	});
});
