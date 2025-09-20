import type { Memento } from "vscode";

// Maximum number of recent URLs to store.
const MAX_URLS = 10;

export class MementoManager {
	constructor(private readonly memento: Memento) {}

	/**
	 * Add the URL to the list of recently accessed URLs in global storage, then
	 * set it as the last used URL.
	 *
	 * If the URL is falsey, then remove it as the last used URL and do not touch
	 * the history.
	 */
	public async setUrl(url?: string): Promise<void> {
		await this.memento.update("url", url);
		if (url) {
			const history = this.withUrlHistory(url);
			await this.memento.update("urlHistory", history);
		}
	}

	/**
	 * Get the last used URL.
	 */
	public getUrl(): string | undefined {
		return this.memento.get("url");
	}

	/**
	 * Get the most recently accessed URLs (oldest to newest) with the provided
	 * values appended. Duplicates will be removed.
	 */
	public withUrlHistory(...append: (string | undefined)[]): string[] {
		const val = this.memento.get("urlHistory");
		const urls = Array.isArray(val) ? new Set(val) : new Set();
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

	/**
	 * Mark this as the first connection to a workspace, which influences whether
	 * the workspace startup confirmation is shown to the user.
	 */
	public async setFirstConnect(): Promise<void> {
		return this.memento.update("firstConnect", true);
	}

	/**
	 * Check if this is the first connection to a workspace and clear the flag.
	 * Used to determine whether to automatically start workspaces without
	 * prompting the user for confirmation.
	 */
	public async getAndClearFirstConnect(): Promise<boolean> {
		const isFirst = this.memento.get<boolean>("firstConnect");
		if (isFirst !== undefined) {
			await this.memento.update("firstConnect", undefined);
		}
		return isFirst === true;
	}
}
