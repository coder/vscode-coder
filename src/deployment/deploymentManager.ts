import { CoderApi } from "../api/coderApi";
import {
	CONFIG_CHANGE_DEBOUNCE_MS,
	watchConfigurationChanges,
} from "../configWatcher";
import { type ServiceContainer } from "../core/container";
import { type ContextManager } from "../core/contextManager";
import { type MementoManager } from "../core/mementoManager";
import { type SecretsManager } from "../core/secretsManager";
import { type Logger } from "../logging/logger";
import { type OAuthSessionManager } from "../oauth/sessionManager";
import { getAuthConfigWatchSettings } from "../settings/authConfig";
import { type TelemetryService } from "../telemetry/service";
import { type WorkspaceProvider } from "../workspace/workspacesProvider";

import {
	DeploymentSchema,
	type Deployment,
	type DeploymentWithAuth,
} from "./types";

import type { User } from "coder/site/src/api/typesGenerated";
import type * as vscode from "vscode";

/**
 * Manages deployment state for the extension.
 *
 * Centralizes:
 * - In-memory deployment state (url, label, token, user)
 * - Client credential updates
 * - OAuth session management
 * - Auth listener registration
 * - Context updates (coder.authenticated, coder.isOwner)
 * - Workspace provider refresh
 * - Cross-window sync handling
 */
export class DeploymentManager implements vscode.Disposable {
	private readonly secretsManager: SecretsManager;
	private readonly mementoManager: MementoManager;
	private readonly contextManager: ContextManager;
	private readonly logger: Logger;
	private readonly telemetryService: TelemetryService;

	#deployment: Deployment | null = null;
	#disposed = false;
	#authListenerDisposable: vscode.Disposable | undefined;
	#authConfigDisposable: vscode.Disposable | undefined;
	#recoveryRunning = false;
	#recoveryPending = false;
	#crossWindowSyncDisposable: vscode.Disposable | undefined;

	private constructor(
		serviceContainer: ServiceContainer,
		private readonly client: CoderApi,
		private readonly oauthSessionManager: OAuthSessionManager,
		private readonly workspaceProviders: WorkspaceProvider[],
	) {
		this.secretsManager = serviceContainer.getSecretsManager();
		this.mementoManager = serviceContainer.getMementoManager();
		this.contextManager = serviceContainer.getContextManager();
		this.logger = serviceContainer.getLogger();
		this.telemetryService = serviceContainer.getTelemetryService();
	}

	public static create(
		serviceContainer: ServiceContainer,
		client: CoderApi,
		oauthSessionManager: OAuthSessionManager,
		workspaceProviders: WorkspaceProvider[],
	): DeploymentManager {
		const manager = new DeploymentManager(
			serviceContainer,
			client,
			oauthSessionManager,
			workspaceProviders,
		);
		manager.subscribeToAuthConfigChanges();
		manager.subscribeToCrossWindowChanges();
		return manager;
	}

	/**
	 * Get the current deployment state.
	 */
	public getCurrentDeployment(): Deployment | null {
		return this.#deployment;
	}

	/**
	 * Check if we have an authenticated deployment (does not guarantee that the current auth data is valid).
	 */
	public isAuthenticated(): boolean {
		return this.contextManager.get("coder.authenticated");
	}

	/**
	 * Verify credentials and apply the deployment on success. Used for
	 * fresh logins and for un-suspending a session after auth settings or
	 * a token become valid again. Bails if state moved during the verify
	 * (logout, another login, dispose), so callers don't need a race guard.
	 */
	public async verifyAndApplyDeployment(
		deployment: Deployment & { token?: string },
	): Promise<boolean> {
		const deploymentBefore = this.#deployment;
		const token =
			deployment.token ??
			(await this.secretsManager.getSessionAuth(deployment.safeHostname))
				?.token;
		const tempClient = CoderApi.create(deployment.url, token, this.logger);

		try {
			const user = await tempClient.getAuthenticatedUser();
			if (this.#hasStateChangedSince(deploymentBefore)) {
				return false;
			}
			await this.setDeployment({ ...deployment, token, user });
			return true;
		} catch (e) {
			this.logger.warn("Failed to authenticate with deployment:", e);
			return false;
		} finally {
			tempClient.dispose();
		}
	}

	/** True if disposal, login, or a deployment switch raced our await. */
	#hasStateChangedSince(deploymentBefore: Deployment | null): boolean {
		return (
			this.#disposed ||
			this.isAuthenticated() ||
			this.#deployment !== deploymentBefore
		);
	}

	/**
	 * Change to a fully authenticated deployment (with user).
	 * Use this when you already have the user from a successful login.
	 */
	public async setDeployment(
		deployment: DeploymentWithAuth & { user: User },
	): Promise<void> {
		this.logger.debug("Setting deployment", {
			hostname: deployment.safeHostname,
			user: deployment.user.username,
		});
		this.#deployment = { ...deployment };
		const ourRef = this.#deployment;
		this.telemetryService.setDeploymentUrl(deployment.url);

		// Updates client credentials
		if (deployment.token === undefined) {
			this.client.setHost(deployment.url);
		} else {
			this.client.setCredentials(deployment.url, deployment.token);
		}

		// Register auth listener before setDeployment so background token refresh
		// can update client credentials via the listener
		this.registerAuthListener();
		// Contexts must be set before refresh (providers check isAuthenticated)
		this.updateAuthContexts(deployment.user);
		this.refreshWorkspaces();

		const deploymentWithoutAuth: Deployment =
			DeploymentSchema.parse(deployment);
		await this.oauthSessionManager.setDeployment(deploymentWithoutAuth);
		// Bail if a concurrent write took over during the await.
		if (this.#deployment !== ourRef) {
			return;
		}
		await this.persistDeployment(deploymentWithoutAuth);
	}

	/**
	 * Clears the current deployment.
	 */
	public async clearDeployment(): Promise<void> {
		this.logger.debug("Clearing deployment", this.#deployment?.safeHostname);
		this.suspendSession();
		this.#authListenerDisposable?.dispose();
		this.#authListenerDisposable = undefined;
		this.#deployment = null;
		this.telemetryService.setDeploymentUrl("");

		await this.secretsManager.setCurrentDeployment(undefined);
	}

	/**
	 * Suspend session: shows logged-out state but keeps deployment for easy re-login.
	 * Auth listener remains active so recovery can happen automatically if tokens update.
	 */
	public suspendSession(): void {
		this.oauthSessionManager.clearDeployment();
		this.client.setCredentials(undefined, undefined);
		this.updateAuthContexts(undefined);
		this.clearWorkspaces();
	}

	/**
	 * Clear all workspace providers without fetching.
	 */
	private clearWorkspaces(): void {
		for (const provider of this.workspaceProviders) {
			provider.clear();
		}
	}

	public dispose(): void {
		this.#disposed = true;
		this.#authListenerDisposable?.dispose();
		this.#authConfigDisposable?.dispose();
		this.#crossWindowSyncDisposable?.dispose();
	}

	/**
	 * Register auth listener for the current deployment.
	 * Updates credentials when they change (token refresh, cross-window sync).
	 * Also handles recovery from suspended session state.
	 */
	private registerAuthListener(): void {
		if (!this.#deployment) {
			return;
		}

		// Capture hostname at registration time for the guard clause
		const safeHostname = this.#deployment.safeHostname;

		this.#authListenerDisposable?.dispose();
		this.logger.debug("Registering auth listener for hostname", safeHostname);
		this.#authListenerDisposable = this.secretsManager.onDidChangeSessionAuth(
			safeHostname,
			async (auth) => {
				if (this.#deployment?.safeHostname !== safeHostname) {
					return;
				}

				if (auth) {
					if (this.isAuthenticated()) {
						this.client.setCredentials(auth.url, auth.token);
					} else {
						this.logger.debug(
							"Token updated after session suspended, recovering",
						);
						await this.verifyAndApplyDeployment({
							url: auth.url,
							safeHostname,
							token: auth.token,
						});
					}
				} else {
					await this.clearDeployment();
				}
			},
		);
	}

	private subscribeToAuthConfigChanges(): void {
		this.#authConfigDisposable = watchConfigurationChanges(
			getAuthConfigWatchSettings(),
			() => this.onAuthConfigChange(),
			{ debounceMs: CONFIG_CHANGE_DEBOUNCE_MS },
		);
	}

	private onAuthConfigChange(): void {
		// One recovery at a time; mark pending so a settings change during the
		// current pass triggers a fresh attempt once it settles.
		if (this.#recoveryRunning) {
			this.#recoveryPending = true;
			return;
		}
		this.#recoveryRunning = true;
		void this.runRecovery();
	}

	private async runRecovery(): Promise<void> {
		try {
			do {
				this.#recoveryPending = false;
				const snapshot = this.#deployment;
				if (this.#disposed || !snapshot || this.isAuthenticated()) {
					return;
				}
				this.logger.debug(
					"Authentication settings changed after session suspended, recovering",
				);
				await this.verifyAndApplyDeployment(snapshot);
			} while (this.#recoveryPending);
		} catch (err) {
			this.logger.warn(
				"Failed to recover session after authentication settings changed",
				err,
			);
		} finally {
			this.#recoveryRunning = false;
		}
	}

	private subscribeToCrossWindowChanges(): void {
		this.#crossWindowSyncDisposable =
			this.secretsManager.onDidChangeCurrentDeployment(
				async ({ deployment }) => {
					if (this.isAuthenticated()) {
						return;
					}

					if (deployment) {
						this.logger.info("Deployment changed from another window");
						await this.verifyAndApplyDeployment(deployment);
					}
				},
			);
	}

	/**
	 * Update authentication-related contexts.
	 */
	private updateAuthContexts(user: User | undefined): void {
		this.contextManager.set("coder.authenticated", Boolean(user));
		const isOwner = user?.roles.some((r) => r.name === "owner") ?? false;
		this.contextManager.set("coder.isOwner", isOwner);
	}

	/**
	 * Refresh all workspace providers asynchronously.
	 */
	private refreshWorkspaces(): void {
		for (const provider of this.workspaceProviders) {
			void provider.fetchAndRefresh();
		}
	}

	/**
	 * Persist deployment to storage for cross-window sync.
	 */
	private async persistDeployment(deployment: Deployment): Promise<void> {
		await this.secretsManager.setCurrentDeployment(deployment);
		await this.mementoManager.addToUrlHistory(deployment.url);
	}
}
