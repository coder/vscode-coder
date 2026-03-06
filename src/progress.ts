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
