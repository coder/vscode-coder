import * as vscode from "vscode";

import type { Logger } from "../logging/logger";

/** What a task asks for once it is done. */
export type NextRun = { readonly delayMs: number } | "retry" | "idle";

export interface RetryOptions {
	/** Delay after the first failure in a row. Each one after doubles it. */
	readonly initialDelayMs: number;
	readonly maxDelayMs: number;
}

/**
 * Runs one task at a time, on the schedule the task asks for. Starting a run
 * cancels the token of the run in flight, so a superseded task can drop what
 * it fetched instead of publishing it.
 */
export class Poller implements vscode.Disposable {
	private source: vscode.CancellationTokenSource | undefined;
	private timer: NodeJS.Timeout | undefined;
	private retries = 0;
	private settledPromise = Promise.resolve();

	constructor(
		private readonly task: (
			token: vscode.CancellationToken,
		) => Promise<NextRun>,
		private readonly retry: RetryOptions,
		private readonly logger: Logger,
	) {}

	/**
	 * The run in flight, or the last one. Never rejects: a task that throws is
	 * logged and retried.
	 */
	public get settled(): Promise<void> {
		return this.settledPromise;
	}

	/** Cancel the run in flight and run the task now, starting the backoff over. */
	public run(): Promise<void> {
		this.retries = 0;
		return this.start();
	}

	public dispose(): void {
		this.cancel();
	}

	private start(): Promise<void> {
		this.cancel();
		const source = new vscode.CancellationTokenSource();
		this.source = source;
		this.settledPromise = this.attempt(source.token).finally(() => {
			if (this.source === source) {
				this.source = undefined;
			}
			source.dispose();
		});
		return this.settledPromise;
	}

	private async attempt(token: vscode.CancellationToken): Promise<void> {
		let next: NextRun;
		try {
			next = await this.task(token);
		} catch (error) {
			this.logger.error("Unexpected failure in a polled task", error);
			next = "retry";
		}
		// A superseded or disposed run schedules nothing.
		if (token.isCancellationRequested) {
			return;
		}
		this.retries = next === "retry" ? this.retries + 1 : 0;
		if (next === "idle") {
			return;
		}
		const delayMs =
			next === "retry"
				? Math.min(
						this.retry.initialDelayMs * 2 ** (this.retries - 1),
						this.retry.maxDelayMs,
					)
				: next.delayMs;
		this.timer = setTimeout(() => void this.start(), delayMs);
	}

	private cancel(): void {
		clearTimeout(this.timer);
		this.source?.cancel();
		this.source = undefined;
	}
}
