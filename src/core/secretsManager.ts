import { type Logger } from "../logging/logger";
import { toSafeHost } from "../util";

import type { Memento, SecretStorage, Disposable } from "vscode";

import type { Deployment } from "../deployment/types";

// Each deployment has its own key to ensure atomic operations (multiple windows
// writing to a shared key could drop data) and to receive proper VS Code events.
const SESSION_KEY_PREFIX = "coder.session.";

const CURRENT_DEPLOYMENT_KEY = "coder.currentDeployment";

const DEPLOYMENT_USAGE_KEY = "coder.deploymentUsage";
const DEFAULT_MAX_DEPLOYMENTS = 10;

const LEGACY_SESSION_TOKEN_KEY = "sessionToken";

export interface CurrentDeploymentState {
	deployment: Deployment | null;
}

export interface SessionAuth {
	url: string;
	token: string;
}

// Tracks when a deployment was last accessed for LRU pruning.
interface DeploymentUsage {
	safeHostname: string;
	lastAccessedAt: string;
}

export class SecretsManager {
	constructor(
		private readonly secrets: SecretStorage,
		private readonly memento: Memento,
		private readonly logger: Logger,
	) {}

	/**
	 * Sets the current deployment and triggers a cross-window sync event.
	 */
	public async setCurrentDeployment(
		deployment: Deployment | undefined,
	): Promise<void> {
		const state: CurrentDeploymentState & { timestamp: string } = {
			// Extract the necessary fields before serializing
			deployment: deployment
				? {
						url: deployment?.url,
						safeHostname: deployment?.safeHostname,
					}
				: null,
			timestamp: new Date().toISOString(),
		};
		await this.secrets.store(CURRENT_DEPLOYMENT_KEY, JSON.stringify(state));
	}

	/**
	 * Gets the current deployment from storage.
	 */
	public async getCurrentDeployment(): Promise<Deployment | null> {
		try {
			const data = await this.secrets.get(CURRENT_DEPLOYMENT_KEY);
			if (!data) {
				return null;
			}
			const parsed = JSON.parse(data) as CurrentDeploymentState;
			return parsed.deployment;
		} catch {
			return null;
		}
	}

	/**
	 * Listens for deployment changes from any VS Code window.
	 * Fires when login, logout, or deployment switch occurs.
	 */
	public onDidChangeCurrentDeployment(
		listener: (state: CurrentDeploymentState) => void | Promise<void>,
	): Disposable {
		return this.secrets.onDidChange(async (e) => {
			if (e.key !== CURRENT_DEPLOYMENT_KEY) {
				return;
			}

			const deployment = await this.getCurrentDeployment();
			try {
				await listener({ deployment });
			} catch (err) {
				this.logger.error(
					"Error in onDidChangeCurrentDeployment listener",
					err,
				);
			}
		});
	}

	/**
	 * Listen for changes to a specific deployment's session auth.
	 */
	public onDidChangeSessionAuth(
		safeHostname: string,
		listener: (auth: SessionAuth | undefined) => void | Promise<void>,
	): Disposable {
		const sessionKey = this.getSessionKey(safeHostname);
		return this.secrets.onDidChange(async (e) => {
			if (e.key !== sessionKey) {
				return;
			}
			const auth = await this.getSessionAuth(safeHostname);
			try {
				await listener(auth);
			} catch (err) {
				this.logger.error("Error in onDidChangeSessionAuth listener", err);
			}
		});
	}

	public async getSessionAuth(
		safeHostname: string,
	): Promise<SessionAuth | undefined> {
		const sessionKey = this.getSessionKey(safeHostname);
		try {
			const data = await this.secrets.get(sessionKey);
			if (!data) {
				return undefined;
			}
			return JSON.parse(data) as SessionAuth;
		} catch {
			return undefined;
		}
	}

	public async setSessionAuth(
		safeHostname: string,
		auth: SessionAuth,
	): Promise<void> {
		const sessionKey = this.getSessionKey(safeHostname);
		// Extract only url and token before serializing
		const state: SessionAuth = { url: auth.url, token: auth.token };
		await this.secrets.store(sessionKey, JSON.stringify(state));
		await this.recordDeploymentAccess(safeHostname);
	}

	private async clearSessionAuth(safeHostname: string): Promise<void> {
		const sessionKey = this.getSessionKey(safeHostname);
		await this.secrets.delete(sessionKey);
	}

	private getSessionKey(safeHostname: string): string {
		return `${SESSION_KEY_PREFIX}${safeHostname || "<legacy>"}`;
	}

	/**
	 * Record that a deployment was accessed, moving it to the front of the LRU list.
	 * Prunes deployments beyond maxCount, clearing their auth data.
	 */
	public async recordDeploymentAccess(
		safeHostname: string,
		maxCount = DEFAULT_MAX_DEPLOYMENTS,
	): Promise<void> {
		const usage = this.getDeploymentUsage();
		const filtered = usage.filter((u) => u.safeHostname !== safeHostname);
		filtered.unshift({
			safeHostname,
			lastAccessedAt: new Date().toISOString(),
		});

		const toKeep = filtered.slice(0, maxCount);
		const toRemove = filtered.slice(maxCount);

		await Promise.all(
			toRemove.map((u) => this.clearAllAuthData(u.safeHostname)),
		);
		await this.memento.update(DEPLOYMENT_USAGE_KEY, toKeep);
	}

	/**
	 * Clear all auth data for a deployment and remove it from the usage list.
	 */
	public async clearAllAuthData(safeHostname: string): Promise<void> {
		await this.clearSessionAuth(safeHostname);
		const usage = this.getDeploymentUsage().filter(
			(u) => u.safeHostname !== safeHostname,
		);
		await this.memento.update(DEPLOYMENT_USAGE_KEY, usage);
	}

	/**
	 * Get all known hostnames, ordered by most recently accessed.
	 */
	public getKnownSafeHostnames(): string[] {
		return this.getDeploymentUsage().map((u) => u.safeHostname);
	}

	/**
	 * Get the full deployment usage list with access timestamps.
	 */
	private getDeploymentUsage(): DeploymentUsage[] {
		return this.memento.get<DeploymentUsage[]>(DEPLOYMENT_USAGE_KEY) ?? [];
	}

	/**
	 * Migrate from legacy flat sessionToken storage to new format.
	 * Also sets the current deployment if none exists.
	 */
	public async migrateFromLegacyStorage(): Promise<string | undefined> {
		const legacyUrl = this.memento.get<string>("url");
		if (!legacyUrl) {
			return undefined;
		}

		const oldToken = await this.secrets.get(LEGACY_SESSION_TOKEN_KEY);

		await this.secrets.delete(LEGACY_SESSION_TOKEN_KEY);
		await this.memento.update("url", undefined);

		const safeHostname = toSafeHost(legacyUrl);
		const existing = await this.getSessionAuth(safeHostname);
		if (!existing) {
			await this.setSessionAuth(safeHostname, {
				url: legacyUrl,
				token: oldToken ?? "",
			});
		}

		// Also set as current deployment if none exists
		const currentDeployment = await this.getCurrentDeployment();
		if (!currentDeployment) {
			await this.setCurrentDeployment({ url: legacyUrl, safeHostname });
		}

		return safeHostname;
	}
}
