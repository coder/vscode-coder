import { z } from "zod";

import type { Memento } from "vscode";

/** Maximum number of recent URLs to store. */
const MAX_URLS = 10;

const DEPLOYMENT_ACCESS_PREFIX = "coder.access.";
const SURFACED_BANNERS_PREFIX = "coder.surfacedBanners.";

const SurfacedBannersSchema = z.array(z.string());

/** Pending values expire after this duration to guard against stale
 * state from crashes or interrupted reloads. */
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

	/** Record when a deployment was last accessed, for most-recently-used ordering. */
	public async updateDeploymentAccess(safeHostname: string): Promise<void> {
		await this.memento.update(
			`${DEPLOYMENT_ACCESS_PREFIX}${safeHostname}`,
			new Date().toISOString(),
		);
	}

	public getDeploymentAccess(safeHostname: string): string | undefined {
		return this.memento.get<string>(
			`${DEPLOYMENT_ACCESS_PREFIX}${safeHostname}`,
		);
	}

	/** The pre-multi-deployment URL key, read during legacy migration. */
	public getLegacyUrl(): string | undefined {
		return this.memento.get<string>("url");
	}

	public async clearLegacyUrl(): Promise<void> {
		await this.memento.update("url", undefined);
	}

	public getSurfacedBanners(safeHostname: string): string[] {
		const raw = this.memento.get<unknown>(
			`${SURFACED_BANNERS_PREFIX}${safeHostname}`,
		);
		const result = SurfacedBannersSchema.safeParse(raw);
		return result.success ? result.data : [];
	}

	/**
	 * Merge banner keys into the surfaced set. The read-modify-write lives
	 * here so a future atomic Memento update can be adopted in one place.
	 */
	public async addSurfacedBanners(
		safeHostname: string,
		bannerKeys: readonly string[],
	): Promise<void> {
		const existing = this.getSurfacedBanners(safeHostname);
		const merged = new Set([...existing, ...bannerKeys]);
		if (merged.size > existing.length) {
			await this.memento.update(`${SURFACED_BANNERS_PREFIX}${safeHostname}`, [
				...merged,
			]);
		}
	}

	/** Clear all per-deployment state (access timestamp, surfaced banners). */
	public async clearDeploymentData(safeHostname: string): Promise<void> {
		await Promise.all([
			this.memento.update(
				`${DEPLOYMENT_ACCESS_PREFIX}${safeHostname}`,
				undefined,
			),
			this.memento.update(
				`${SURFACED_BANNERS_PREFIX}${safeHostname}`,
				undefined,
			),
		]);
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
