import { describe, expect, it, onTestFinished, vi } from "vitest";

import { Poller, type NextRun, type RetryOptions } from "@/util/poller";

import { createMockLogger, flushPromises } from "../../mocks/testHelpers";

import type * as vscode from "vscode";

const RETRY: RetryOptions = { initialDelayMs: 1_000, maxDelayMs: 4_000 };
const POLL: NextRun = { delayMs: 1_000 };

/** A poller whose task answers with `results`, oldest first; the rest hang. */
function setup(...results: NextRun[]) {
	vi.useFakeTimers();
	const tokens: vscode.CancellationToken[] = [];
	const hanging: Array<PromiseWithResolvers<NextRun>> = [];
	const task = vi.fn((token: vscode.CancellationToken) => {
		tokens.push(token);
		const next = results.shift();
		if (next !== undefined) {
			return Promise.resolve(next);
		}
		const run = Promise.withResolvers<NextRun>();
		hanging.push(run);
		return run.promise;
	});
	const logger = createMockLogger();
	const poller = new Poller(task, RETRY, logger);
	onTestFinished(() => {
		poller.dispose();
		vi.useRealTimers();
	});
	return {
		poller,
		task,
		tokens,
		logger,
		/** Settle the oldest run still hanging. */
		finish: (next: NextRun) => {
			hanging.shift()?.resolve(next);
			return flushPromises();
		},
		fail: (error: Error) => {
			hanging.shift()?.reject(error);
			return flushPromises();
		},
	};
}

describe("Poller", () => {
	interface RunsCase {
		name: string;
		result: NextRun;
		runs: number;
	}

	it.each<RunsCase>([
		{ name: "a delay", result: POLL, runs: 2 },
		{ name: "retry", result: "retry", runs: 2 },
		{ name: "idle", result: "idle", runs: 1 },
	])("answering $name runs the task $runs times", async ({ result, runs }) => {
		const h = setup(result, "idle");
		await h.poller.run();
		await vi.advanceTimersByTimeAsync(POLL.delayMs);
		expect(h.task).toHaveBeenCalledTimes(runs);
	});

	it("backs off while the task keeps failing, and starts over after a success", async () => {
		const h = setup("retry", "retry", "retry", "retry", POLL, "retry", "idle");
		await h.poller.run();
		// One initial delay, then doubling, then held at the cap.
		for (const [delayMs, runs] of [
			[1_000, 2],
			[2_000, 3],
			[4_000, 4],
			[4_000, 5],
		]) {
			await vi.advanceTimersByTimeAsync(delayMs);
			expect(h.task).toHaveBeenCalledTimes(runs);
		}
		// The poll that succeeded reset the backoff.
		await vi.advanceTimersByTimeAsync(POLL.delayMs + 1_000);
		expect(h.task).toHaveBeenCalledTimes(7);
	});

	it("retries a task that throws, and logs why", async () => {
		const h = setup();
		const running = h.poller.run();
		await h.fail(new Error("boom"));
		await running;
		await vi.advanceTimersByTimeAsync(1_000);
		expect(h.task).toHaveBeenCalledTimes(2);
		expect(h.logger.error).toHaveBeenCalled();
	});

	it("hands each run its own token, cancelling the one it supersedes", async () => {
		const h = setup();
		const superseded = h.poller.run();
		void h.poller.run();
		expect(h.tokens.map((t) => t.isCancellationRequested)).toEqual([
			true,
			false,
		]);

		// What a superseded run answers schedules nothing.
		await h.finish(POLL);
		await superseded;
		await vi.advanceTimersByTimeAsync(4_000);
		expect(h.task).toHaveBeenCalledTimes(2);
	});

	it("schedules nothing once disposed, pending or in flight", async () => {
		const h = setup(POLL);
		await h.poller.run();
		const running = h.poller.run();
		h.poller.dispose();
		expect(h.tokens[1].isCancellationRequested).toBe(true);
		await h.finish(POLL);
		await running;
		await vi.advanceTimersByTimeAsync(4_000);
		expect(h.task).toHaveBeenCalledTimes(2);
	});
});
