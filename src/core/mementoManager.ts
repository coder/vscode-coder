import type { Memento } from "vscode";

// Maximum number of recent URLs to store.
const MAX_URLS = 10;

// Pending values expire after this duration to guard against stale
// state from crashes or interrupted reloads.
const PENDING_TTL_MS = 5 * 60 * 1000;

/**
 * Describes the startup intent when the extension connects to a workspace.
 * - "none":    No explicit intent; ask before starting a stopped workspace.
 * - "start":   User-initiated open/restart; auto-start without prompting.
 * - "update":  User-initiated restart + update; use `coder update` to apply
 *              the latest template version, auto-starting without prompting.
 */
export type StartupMode = "none" | "start" | "update";

interface Stamped<T> {
	value: T;
	setAt: number;
}

export class MementoManager {
	constructor(private readonly memento: Memento) {}

	/**
	 * Add a URL to the history of recently accessed URLs.
	 * Used by the URL picker to show recent deployments.
	 */
	public async addToUrlHistory(url: string): Promise<void> {
		if (url) {
			const history = this.withUrlHistory(url);
			await this.memento.update("urlHistory", history);
		}
	}

	/**
	 * Get the most recently accessed URLs (oldest to newest) with the provided
	 * values appended. Duplicates will be removed.
	 */
	public withUrlHistory(...append: Array<string | undefined>): string[] {
		const val = this.memento.get<string[]>("urlHistory");
		const urls: Set<string> = Array.isArray(val) ? new Set(val) : new Set();
		for (const url of append) {
			if (url) {
				// It might exist; delete first so it gets appended.
				urls.delete(url);
				urls.add(url);
			}
		}
		// Slice off the head if the list is too large.
		return urls.size > MAX_URLS
			? Array.from(urls).slice(urls.size - MAX_URLS, urls.size)
			: Array.from(urls);
	}

	/** Set the startup mode for the next workspace connection. */
	public async setStartupMode(mode: StartupMode): Promise<void> {
		await this.setStamped("startupMode", mode);
	}

	/**
	 * Read and clear the startup mode.
	 * Returns "none" (the default) when no mode was explicitly set.
	 */
	public async getAndClearStartupMode(): Promise<StartupMode> {
		const value = this.getStamped<StartupMode>("startupMode");
		if (value !== undefined) {
			await this.memento.update("startupMode", undefined);
		}
		return value ?? "none";
	}

	/** Store a chat ID to open after a remote-authority reload. */
	public async setPendingChatId(chatId: string): Promise<void> {
		await this.setStamped("pendingChatId", chatId);
	}

	/** Read and clear the pending chat ID (undefined if none). */
	public async getAndClearPendingChatId(): Promise<string | undefined> {
		const chatId = this.getStamped<string>("pendingChatId");
		if (chatId !== undefined) {
			await this.memento.update("pendingChatId", undefined);
		}
		return chatId;
	}

	/** Clear the pending chat ID without reading it. */
	public async clearPendingChatId(): Promise<void> {
		await this.memento.update("pendingChatId", undefined);
	}

	private async setStamped<T>(key: string, value: T): Promise<void> {
		await this.memento.update(key, { value, setAt: Date.now() });
	}

	private getStamped<T>(key: string): T | undefined {
		const raw = this.memento.get<Stamped<T>>(key);
		if (raw?.setAt !== undefined && Date.now() - raw.setAt <= PENDING_TTL_MS) {
			return raw.value;
		}
		// Expired or legacy, clean up.
		if (raw !== undefined) {
			void this.memento.update(key, undefined);
		}
		return undefined;
	}
}
