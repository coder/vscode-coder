import * as vscode from "vscode";

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
	options: vscode.ProgressOptions & { cancellable: true },
	fn: (ctx: ProgressContext) => Promise<T>,
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
				if ((error as Error).name === "AbortError") {
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
