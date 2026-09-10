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

const PENDING: AgentMetadataState = { kind: "pending" };

/** One watched agent: its socket, and what it last reported. */
class WatchedAgent {
	/** Pending close, set while nothing watches the agent. */
	public linger: NodeJS.Timeout | undefined;
	private current: AgentMetadataState = PENDING;
	private watcher: AgentMetadataWatcher | undefined;
	private opening: Promise<void> | undefined;
	private closed = false;

	constructor(
		private readonly agentId: AgentId,
		private readonly client: AgentMetadataClient,
		private readonly onReport: (agent: WatchedAgent) => void,
	) {}

	public get state(): AgentMetadataState {
		return this.current;
	}

	/** Open the socket unless one is open or opening. Resolves once it settled. */
	public ensureOpen(): Promise<void> {
		if (!this.opening && (!this.watcher || this.watcher.closed)) {
			this.opening = this.open().finally(() => {
				this.opening = undefined;
			});
		}
		return this.opening ?? Promise.resolve();
	}

	public close(): void {
		this.closed = true;
		clearTimeout(this.linger);
		this.watcher?.dispose();
	}

	private async open(): Promise<void> {
		let watcher: AgentMetadataWatcher;
		try {
			watcher = await createAgentMetadataWatcher(this.agentId, this.client);
		} catch (error) {
			this.report({ kind: "failed", error: formatMetadataError(error) });
			return;
		}
		if (this.closed) {
			watcher.dispose();
			return;
		}
		this.watcher?.dispose();
		this.watcher = watcher;
		watcher.onChange(() => this.reportFrom(watcher));
		// A report may arrive before the subscription.
		if (watcher.metadata !== undefined || watcher.error !== undefined) {
			this.reportFrom(watcher);
		}
	}

	private reportFrom(watcher: AgentMetadataWatcher): void {
		this.report(
			watcher.error === undefined
				? { kind: "reported", metadata: watcher.metadata ?? [] }
				: { kind: "failed", error: formatMetadataError(watcher.error) },
		);
	}

	private report(state: AgentMetadataState): void {
		if (!this.closed) {
			this.current = state;
			this.onReport(this);
		}
	}
}

/**
 * Watches agent metadata over SSE. The watched set is declared, not built up:
 * `watch` opens the sockets it is missing and releases the rest. Released
 * sockets stay open for a while, so watching an agent again is instant.
 */
export class AgentMetadataTracker implements vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	private readonly watched = new Map<AgentId, WatchedAgent>();

	public readonly onDidChange = this.changeEmitter.event;

	private disposed = false;

	constructor(
		private readonly client: AgentMetadataClient,
		/** How long a released socket stays open, in case it is wanted again. */
		private readonly lingerMs = 15_000,
	) {}

	/** What every watched agent reports. Released agents are left out. */
	public get metadata(): AgentMetadataMap {
		return Object.fromEntries(
			[...this.watched]
				.filter(([, agent]) => !agent.linger)
				.map(([agentId, agent]) => [agentId, agent.state]),
		);
	}

	/**
	 * Watch exactly `agentIds`, releasing the rest. A socket that fails to open
	 * is reported against its agent rather than thrown; the next call retries it.
	 */
	public async watch(agentIds: Iterable<AgentId>): Promise<void> {
		if (this.disposed) {
			return;
		}
		const wanted = new Set(agentIds);
		for (const [agentId, agent] of this.watched) {
			if (wanted.has(agentId)) {
				clearTimeout(agent.linger);
				agent.linger = undefined;
			} else {
				agent.linger ??= setTimeout(() => this.close(agentId), this.lingerMs);
			}
		}
		const opening = [...wanted].map((agentId) =>
			(this.watched.get(agentId) ?? this.add(agentId)).ensureOpen(),
		);
		this.fire();
		await Promise.all(opening);
	}

	/** Close every socket now, released or not. */
	public clear(): void {
		for (const agentId of this.watched.keys()) {
			this.close(agentId);
		}
		this.fire();
	}

	public dispose(): void {
		this.disposed = true;
		this.clear();
		this.changeEmitter.dispose();
	}

	private add(agentId: AgentId): WatchedAgent {
		// A released agent's report is kept for when it is watched again.
		const agent = new WatchedAgent(agentId, this.client, (reported) => {
			if (!reported.linger) {
				this.fire();
			}
		});
		this.watched.set(agentId, agent);
		return agent;
	}

	private close(agentId: AgentId): void {
		this.watched.get(agentId)?.close();
		this.watched.delete(agentId);
	}

	private fire(): void {
		if (!this.disposed) {
			this.changeEmitter.fire();
		}
	}
}
