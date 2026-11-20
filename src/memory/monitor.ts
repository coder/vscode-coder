import * as vscode from "vscode";

import { errToStr } from "../error/normalize";
import {
	getMemoryWarningThreshold,
	MEMORY_WARNING_THRESHOLD_SETTING,
} from "../settings/memoryMonitor";

import {
	MemoryPressureTracker,
	type MemoryState,
	type MemoryStatus,
} from "./pressure";

import type { MemoryTelemetry } from "../instrumentation/memory";
import type { Logger } from "../logging/logger";

import type { MemorySample, MemoryUsageSource } from "./usage";

const POLL_INTERVAL_MS = 10_000;

/**
 * Polls workspace memory and reports its state. Keeps polling while the
 * window is unfocused, since workspaces often run out of memory while the
 * user is away. A poll is skipped while the previous one is still reading,
 * because reads stall when the workspace is short on memory.
 */
export class MemoryMonitor implements vscode.Disposable {
	private readonly tracker = new MemoryPressureTracker();
	private readonly emitter = new vscode.EventEmitter<MemoryStatus>();
	private readonly timer: ReturnType<typeof setInterval>;
	private readonly configListener: vscode.Disposable;
	private polling = false;
	private disposed = false;
	private state: MemoryState = "unavailable";

	/** Fires after every poll with the latest status. */
	public readonly onDidChange = this.emitter.event;

	public constructor(
		private readonly readUsage: MemoryUsageSource,
		private readonly telemetry: MemoryTelemetry,
		private readonly logger: Logger,
	) {
		this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
		this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(MEMORY_WARNING_THRESHOLD_SETTING)) {
				void this.poll();
			}
		});
		void this.poll();
	}

	public dispose(): void {
		this.disposed = true;
		clearInterval(this.timer);
		this.configListener.dispose();
		this.emitter.dispose();
	}

	private async poll(): Promise<void> {
		if (this.polling || this.disposed) {
			return;
		}
		this.polling = true;
		const sample = await this.readSample();
		this.polling = false;
		if (this.disposed) {
			return;
		}
		const threshold = getMemoryWarningThreshold(
			vscode.workspace.getConfiguration(),
		);
		const status = this.tracker.update(sample, threshold);
		if (status.state !== this.state) {
			this.logger.debug(`Workspace memory is ${status.state}`);
			this.telemetry.stateTransitioned(this.state, status);
			this.state = status.state;
		}
		this.emitter.fire(status);
	}

	private async readSample(): Promise<MemorySample | undefined> {
		try {
			return await this.readUsage();
		} catch (error) {
			this.logger.debug(`Failed to read workspace memory: ${errToStr(error)}`);
			return undefined;
		}
	}
}
