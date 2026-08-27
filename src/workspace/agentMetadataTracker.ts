import * as vscode from "vscode";

import {
	createAgentMetadataWatcher,
	formatMetadataError,
	type AgentMetadataWatcher,
} from "../api/agentMetadataHelper";

import type {
	AgentMetadataMap,
	AgentMetadataState,
	WorkspaceAgent,
} from "@repo/shared";

import type { CoderApi } from "../api/coderApi";

type AgentId = WorkspaceAgent["id"];

/** Nothing reported yet: the socket is opening, or the agent is quiet. */
const PENDING: AgentMetadataState = {
	metadata: [],
	error: null,
	loading: true,
};

interface WatchedAgent {
	/** Absent while the socket is opening, or after it failed to open. */
	watcher?: AgentMetadataWatcher;
	state: AgentMetadataState;
	/** Pending close, set for exactly as long as nothing is watching. */
	closing?: NodeJS.Timeout;
}

/** A socket that never opened, or died since, needs opening again. */
function needsSocket(watched: WatchedAgent | undefined): boolean {
	if (!watched) {
		return false;
	}
	return !watched.watcher || watched.watcher.closed === true;
}

/**
 * Watches agent metadata over SSE. The watched set is declared, not built up:
 * `setWatched` opens the sockets it is missing, releases the rest, and reports
 * only the agents currently watched.
 */
export class AgentMetadataTracker implements vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<AgentMetadataMap>();
	private readonly watched = new Map<AgentId, WatchedAgent>();

	public readonly onDidChange = this.changeEmitter.event;

	private disposed = false;

	constructor(
		private readonly client: CoderApi,
		/** How long a released socket stays open, in case it is wanted again. */
		private readonly lingerMs = 15_000,
	) {}

	/** The latest report of every watched agent, keyed by agent id. */
	public get metadata(): AgentMetadataMap {
		return Object.fromEntries(
			[...this.watched]
				.filter(([, watched]) => !watched.closing)
				.map(([agentId, watched]) => [agentId, watched.state]),
		);
	}

	/**
	 * Watch exactly `agentIds`. Sockets open in parallel and a failure is
	 * reported against its agent rather than thrown, so one bad socket neither
	 * blocks the rest nor stops the next call from retrying it.
	 */
	public async setWatched(agentIds: Iterable<AgentId>): Promise<void> {
		const wanted = new Set(agentIds);
		let changed = false;

		for (const [agentId, watched] of this.watched) {
			changed = wanted.has(agentId)
				? this.keep(watched) || changed
				: this.release(agentId, watched) || changed;
		}
		for (const agentId of wanted) {
			if (!this.watched.has(agentId)) {
				this.watched.set(agentId, { state: PENDING });
				changed = true;
			}
		}
		if (changed) {
			this.fire();
		}

		const opening = [...wanted].filter((agentId) =>
			needsSocket(this.watched.get(agentId)),
		);
		await Promise.all(opening.map((agentId) => this.open(agentId)));
	}

	public dispose(): void {
		for (const agentId of [...this.watched.keys()]) {
			this.close(agentId);
		}
		this.disposed = true;
		this.changeEmitter.dispose();
	}

	/** Take an agent back before its socket closes. */
	private keep(watched: WatchedAgent): boolean {
		if (!watched.closing) {
			return false;
		}
		clearTimeout(watched.closing);
		watched.closing = undefined;
		return true;
	}

	/** Let an agent go, closing its socket unless it is wanted again in time. */
	private release(agentId: AgentId, watched: WatchedAgent): boolean {
		if (watched.closing) {
			return false;
		}
		watched.closing = setTimeout(() => this.close(agentId), this.lingerMs);
		return true;
	}

	private async open(agentId: AgentId): Promise<void> {
		try {
			const watcher = await createAgentMetadataWatcher(agentId, this.client);
			const watched = this.watched.get(agentId);
			// Disposal, a newer set, or a parallel open may have raced this socket.
			if (this.disposed || !watched || !needsSocket(watched)) {
				watcher.dispose();
				return;
			}
			watched.watcher?.dispose();
			watched.watcher = watcher;
			watcher.onChange(() => this.report(agentId, watcher));
		} catch (error) {
			this.report(agentId, { error });
		}
	}

	/** Record what an agent reported, and push it if it is still watched. */
	private report(
		agentId: AgentId,
		watcher: Partial<AgentMetadataWatcher>,
	): void {
		const watched = this.watched.get(agentId);
		if (this.disposed || !watched) {
			return;
		}
		watched.state = {
			metadata: watcher.metadata ?? [],
			error:
				watcher.error === undefined ? null : formatMetadataError(watcher.error),
			loading: false,
		};
		if (!watched.closing) {
			this.fire();
		}
	}

	private close(agentId: AgentId): void {
		const watched = this.watched.get(agentId);
		if (!watched) {
			return;
		}
		clearTimeout(watched.closing);
		watched.watcher?.dispose();
		this.watched.delete(agentId);
	}

	private fire(): void {
		if (!this.disposed) {
			this.changeEmitter.fire(this.metadata);
		}
	}
}
