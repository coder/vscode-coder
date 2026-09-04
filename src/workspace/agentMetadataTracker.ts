import * as vscode from "vscode";

import {
	createAgentMetadataWatcher,
	formatMetadataError,
	type AgentMetadataWatcher,
	type AgentMetadataClient,
} from "../api/agentMetadataHelper";

import type {
	AgentMetadataMap,
	AgentMetadataState,
	WorkspaceAgent,
} from "@repo/shared";

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
	subscription?: vscode.Disposable;
	opening?: Promise<void>;
	state: AgentMetadataState;
	/** Pending close, set for exactly as long as nothing is watching. */
	closing?: NodeJS.Timeout;
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
		private readonly client: AgentMetadataClient,
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
		if (this.disposed) {
			return;
		}
		const wanted = new Set(agentIds);
		let changed = false;

		for (const [agentId, watched] of this.watched) {
			changed =
				this.setReleased(agentId, watched, !wanted.has(agentId)) || changed;
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

		const opening: Array<Promise<void>> = [];
		for (const agentId of wanted) {
			const watched = this.watched.get(agentId);
			if (!watched || watched.closing) {
				continue;
			}
			if (!watched.opening && (!watched.watcher || watched.watcher.closed)) {
				watched.opening = this.open(agentId, watched).finally(() => {
					watched.opening = undefined;
				});
			}
			if (watched.opening) {
				opening.push(watched.opening);
			}
		}
		await Promise.all(opening);
	}

	/** Close all session-owned sockets immediately, without lingering. */
	public clear(): void {
		const reported = Object.keys(this.metadata).length > 0;
		for (const agentId of this.watched.keys()) {
			this.close(agentId);
		}
		if (reported) {
			this.fire();
		}
	}

	public dispose(): void {
		this.disposed = true;
		this.clear();
		this.changeEmitter.dispose();
	}

	/** Retain released sockets briefly; cancel their close when watched again. */
	private setReleased(
		agentId: AgentId,
		watched: WatchedAgent,
		released: boolean,
	): boolean {
		if (released === Boolean(watched.closing)) {
			return false;
		}
		clearTimeout(watched.closing);
		watched.closing = released
			? setTimeout(() => this.close(agentId), this.lingerMs)
			: undefined;
		return true;
	}

	private async open(agentId: AgentId, watched: WatchedAgent): Promise<void> {
		const isCurrent = () =>
			!this.disposed && this.watched.get(agentId) === watched;
		try {
			const watcher = await createAgentMetadataWatcher(agentId, this.client);
			if (!isCurrent()) {
				watcher.dispose();
				return;
			}
			watched.subscription?.dispose();
			watched.watcher?.dispose();
			watched.watcher = watcher;
			watched.subscription = watcher.onChange(() => {
				if (isCurrent() && watched.watcher === watcher) {
					this.report(watched, watcher);
				}
			});
			// A report may arrive before the tracker subscribes.
			if (watcher.metadata !== undefined || watcher.error !== undefined) {
				this.report(watched, watcher);
			}
		} catch (error) {
			if (isCurrent()) {
				this.report(watched, { error });
			}
		}
	}

	/** Record what an agent reported, and push it if it is still watched. */
	private report(
		watched: WatchedAgent,
		watcher: Partial<AgentMetadataWatcher>,
	): void {
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
		this.watched.delete(agentId);
		clearTimeout(watched.closing);
		watched.subscription?.dispose();
		watched.watcher?.dispose();
	}

	private fire(): void {
		if (!this.disposed) {
			this.changeEmitter.fire(this.metadata);
		}
	}
}
