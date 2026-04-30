import * as vscode from "vscode";

import { isAbortError } from "./error/errorUtils";

export type ProgressResult<T> =
	| { ok: true; value: T }
	| { ok: false; cancelled: true }
	| { ok: false; cancelled: false; error: unknown };

export interface ProgressContext {
	progress: vscode.Progress<{ message?: string; increment?: number }>;
	signal: AbortSignal;
}

/**
 * Run a task inside a VS Code progress notification with cancellation support.
 * Errors thrown by the task are captured in the result rather than propagated
 * through `withProgress`, and AbortErrors from cancellation are surfaced as
 * `{ cancelled: true }`.
 */
export function withCancellableProgress<T>(
	fn: (ctx: ProgressContext) => Promise<T>,
	options: vscode.ProgressOptions & { cancellable: true },
): Thenable<ProgressResult<T>> {
	return vscode.window.withProgress(
		options,
		async (progress, ct): Promise<ProgressResult<T>> => {
			const ac = new AbortController();
			const listener = ct.onCancellationRequested(() => ac.abort());
			try {
				const value = await fn({ progress, signal: ac.signal });
				return { ok: true, value };
			} catch (error) {
				if (isAbortError(error)) {
					return { ok: false, cancelled: true };
				}
				return { ok: false, cancelled: false, error };
			} finally {
				listener.dispose();
			}
		},
	);
}

/**
 * Like withCancellableProgress, but only shows the progress notification when
 * `enabled` is true. When false, runs the function directly without UI.
 * Returns ProgressResult<T> in both cases for uniform call-site handling.
 */
export async function withOptionalProgress<T>(
	fn: (ctx: ProgressContext) => Promise<T>,
	options: vscode.ProgressOptions & { cancellable: true; enabled: boolean },
): Promise<ProgressResult<T>> {
	if (options.enabled) {
		return withCancellableProgress(fn, options);
	}
	try {
		const noop = () => {
			// No-op: progress reporting is disabled.
		};
		const value = await fn({
			progress: { report: noop },
			signal: new AbortController().signal,
		});
		return { ok: true, value };
	} catch (error) {
		if (isAbortError(error)) {
			return { ok: false, cancelled: true };
		}
		return { ok: false, cancelled: false, error };
	}
}

/**
 * Run a task inside a VS Code progress notification (no cancellation).
 * A thin wrapper over `vscode.window.withProgress` that passes only the
 * progress reporter, hiding the unused cancellation token.
 */
export function withProgress<T>(
	options: vscode.ProgressOptions,
	fn: (
		progress: vscode.Progress<{ message?: string; increment?: number }>,
	) => Promise<T>,
): Thenable<T> {
	return vscode.window.withProgress(options, (progress) => fn(progress));
}

/** Drive a progress bar from wall-clock time over an expected duration.
 *  Returns a stop function; call it (typically in `finally`) when the work
 *  finishes. */
export function reportElapsedProgress(opts: {
	progress: vscode.Progress<{ message?: string; increment?: number }>;
	totalMs: number;
	format: (pct: number, elapsedMs: number) => string;
	intervalMs?: number;
}): () => void {
	const { progress, totalMs, format, intervalMs = 100 } = opts;
	const startTime = Date.now();
	let reported = 0;
	const timer = setInterval(() => {
		const elapsed = Date.now() - startTime;
		const pct = Math.min(Math.round((elapsed / totalMs) * 100), 100);
		const increment = pct - reported;
		if (increment > 0) {
			progress.report({ message: format(pct, elapsed), increment });
			reported = pct;
		}
	}, intervalMs);
	return () => clearInterval(timer);
}
