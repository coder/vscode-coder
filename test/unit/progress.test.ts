import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	withCancellableProgress,
	withProgress,
	type ProgressContext,
} from "@/progress";

function mockWithProgress(opts?: { cancelImmediately?: boolean }) {
	const dispose = vi.fn();

	vi.mocked(vscode.window.withProgress).mockImplementation(
		async (_opts, task) => {
			const progress = { report: vi.fn() };
			const token: vscode.CancellationToken = {
				isCancellationRequested: false,
				onCancellationRequested: vi.fn((listener: (e: unknown) => void) => {
					if (opts?.cancelImmediately) {
						listener(undefined);
					}
					return { dispose };
				}),
			};
			return task(progress, token);
		},
	);

	return { dispose };
}

describe("withCancellableProgress", () => {
	const options = {
		location: vscode.ProgressLocation.Notification,
		title: "Test operation",
		cancellable: true as const,
	};

	beforeEach(() => {
		mockWithProgress();
	});

	it("returns ok with value on success", async () => {
		const result = await withCancellableProgress(options, () =>
			Promise.resolve(42),
		);

		expect(result).toEqual({ ok: true, value: 42 });
	});

	it("returns cancelled on AbortError", async () => {
		const result = await withCancellableProgress(options, () => {
			const err = new Error("aborted");
			err.name = "AbortError";
			return Promise.reject(err);
		});

		expect(result).toEqual({ ok: false, cancelled: true });
	});

	it("returns error on non-abort failure", async () => {
		const error = new Error("something broke");

		const result = await withCancellableProgress(options, () =>
			Promise.reject(error),
		);

		expect(result).toEqual({ ok: false, cancelled: false, error });
	});

	it("provides progress and signal to callback", async () => {
		let captured: ProgressContext | undefined;

		await withCancellableProgress(options, (ctx) => {
			captured = ctx;
			return Promise.resolve();
		});

		expect(captured).toBeDefined();
		expect(captured!.progress.report).toBeDefined();
		expect(captured!.signal).toBeInstanceOf(AbortSignal);
		expect(captured!.signal.aborted).toBe(false);
	});

	it("aborts signal when cancellation fires", async () => {
		mockWithProgress({ cancelImmediately: true });

		let signalAborted: boolean | undefined;
		await withCancellableProgress(options, ({ signal }) => {
			signalAborted = signal.aborted;
			return Promise.resolve();
		});

		expect(signalAborted).toBe(true);
	});

	it("disposes cancellation listener after completion", async () => {
		const { dispose } = mockWithProgress();

		await withCancellableProgress(options, () => Promise.resolve("done"));

		expect(dispose).toHaveBeenCalled();
	});

	it("disposes cancellation listener on error", async () => {
		const { dispose } = mockWithProgress();

		await withCancellableProgress(options, () =>
			Promise.reject(new Error("fail")),
		);

		expect(dispose).toHaveBeenCalled();
	});

	it("passes options through to withProgress", async () => {
		await withCancellableProgress(options, () => Promise.resolve());

		expect(vscode.window.withProgress).toHaveBeenCalledWith(
			options,
			expect.any(Function),
		);
	});
});

describe("withProgress", () => {
	beforeEach(() => {
		mockWithProgress();
	});

	it("returns the resolved value", async () => {
		const result = await withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "test" },
			() => Promise.resolve(42),
		);

		expect(result).toBe(42);
	});

	it("passes progress reporter to callback", async () => {
		let hasReport = false;

		await withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "test" },
			(progress) => {
				hasReport = typeof progress.report === "function";
				return Promise.resolve();
			},
		);

		expect(hasReport).toBe(true);
	});

	it("propagates errors to the caller", async () => {
		await expect(
			withProgress(
				{ location: vscode.ProgressLocation.Notification, title: "test" },
				() => Promise.reject(new Error("boom")),
			),
		).rejects.toThrow("boom");
	});
});
