import { CoderApi } from "../api/coderApi";

import type { User } from "coder/site/src/api/typesGenerated";
import type * as vscode from "vscode";

import type { ServiceContainer } from "../core/container";
import type { ContextManager } from "../core/contextManager";
import type { MementoManager } from "../core/mementoManager";
import type { SecretsManager } from "../core/secretsManager";
import type { Logger } from "../logging/logger";
import type { WorkspaceProvider } from "../workspace/workspacesProvider";

import type { Deployment, DeploymentWithAuth } from "./types";

/**
 * Internal state type that allows mutation of user property.
 */
type DeploymentWithUser = Deployment & { user: User };

/**
 * Manages deployment state for the extension.
 *
 * Centralizes:
 * - In-memory deployment state (url, label, token, user)
 * - Client credential updates
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

	#deployment: DeploymentWithUser | null = null;
	#authListenerDisposable: vscode.Disposable | undefined;
	#crossWindowSyncDisposable: vscode.Disposable | undefined;

	private constructor(
		serviceContainer: ServiceContainer,
		private readonly client: CoderApi,
		private readonly workspaceProviders: WorkspaceProvider[],
	) {
		this.secretsManager = serviceContainer.getSecretsManager();
		this.mementoManager = serviceContainer.getMementoManager();
		this.contextManager = serviceContainer.getContextManager();
		this.logger = serviceContainer.getLogger();
	}

	public static create(
		serviceContainer: ServiceContainer,
		client: CoderApi,
		workspaceProviders: WorkspaceProvider[],
	): DeploymentManager {
		const manager = new DeploymentManager(
			serviceContainer,
			client,
			workspaceProviders,
		);
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
		return this.#deployment !== null;
	}

	/**
	 * Attempt to change to a deployment after validating authentication.
	 * Only changes deployment if authentication succeeds.
	 * Returns true if deployment was changed, false otherwise.
	 */
	public async setDeploymentIfValid(
		deployment: Deployment & { token?: string },
	): Promise<boolean> {
		const auth = await this.secretsManager.getSessionAuth(
			deployment.safeHostname,
		);
		const token = deployment.token ?? auth?.token;
		const tempClient = CoderApi.create(deployment.url, token, this.logger);

		try {
			const user = await tempClient.getAuthenticatedUser();

			// Authentication succeeded - now change the deployment
			await this.setDeployment({
				...deployment,
				token,
				user,
			});
			return true;
		} catch (e) {
			this.logger.warn("Failed to authenticate with deployment:", e);
			return false;
		} finally {
			tempClient.dispose();
		}
	}

	/**
	 * Change to a fully authenticated deployment (with user).
	 * Use this when you already have the user from a successful login.
	 */
	public async setDeployment(
		deployment: DeploymentWithAuth & { user: User },
	): Promise<void> {
		this.#deployment = { ...deployment };

		// Updates client credentials
		if (deployment.token === undefined) {
			this.client.setHost(deployment.url);
		} else {
			this.client.setCredentials(deployment.url, deployment.token);
		}

		this.registerAuthListener();
		this.updateAuthContexts();
		this.refreshWorkspaces();
		await this.persistDeployment(deployment);
	}

	/**
	 * Clears the current deployment.
	 */
	public async clearDeployment(): Promise<void> {
		this.#authListenerDisposable?.dispose();
		this.#authListenerDisposable = undefined;
		this.#deployment = null;

		this.client.setCredentials(undefined, undefined);
		this.updateAuthContexts();
		this.refreshWorkspaces();

		await this.secretsManager.setCurrentDeployment(undefined);
	}

	public dispose(): void {
		this.#authListenerDisposable?.dispose();
		this.#crossWindowSyncDisposable?.dispose();
	}

	/**
	 * Register auth listener for the current deployment.
	 * Updates credentials when they change (token refresh, cross-window sync).
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
					this.client.setCredentials(auth.url, auth.token);
				} else {
					await this.clearDeployment();
				}
			},
		);
	}

	private subscribeToCrossWindowChanges(): void {
		this.#crossWindowSyncDisposable =
			this.secretsManager.onDidChangeCurrentDeployment(
				async ({ deployment }) => {
					if (this.isAuthenticated()) {
						// Ignore if we are already authenticated
						return;
					}

					if (deployment) {
						this.logger.info("Deployment changed from another window");
						await this.setDeploymentIfValid(deployment);
					}
				},
			);
	}

	/**
	 * Update authentication-related contexts.
	 */
	private updateAuthContexts(): void {
		const user = this.#deployment?.user;
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
