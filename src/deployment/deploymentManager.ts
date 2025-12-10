import type { User } from "coder/site/src/api/typesGenerated";
import type * as vscode from "vscode";

import type { CoderApi } from "../api/coderApi";
import type { ServiceContainer } from "../core/container";
import type { ContextManager } from "../core/contextManager";
import type { MementoManager } from "../core/mementoManager";
import type { SecretsManager } from "../core/secretsManager";
import type { Logger } from "../logging/logger";
import type { WorkspaceProvider } from "../workspace/workspacesProvider";

import type { Deployment, DeploymentWithAuth } from "./types";

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

	private currentDeployment: (Deployment & { user?: User }) | null = null;
	private authListenerDisposable: vscode.Disposable | undefined;
	private crossWindowSyncDisposable: vscode.Disposable | undefined;

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
		return this.currentDeployment;
	}

	/**
	 * Check if we have an authenticated deployment (with a valid user).
	 */
	public isAuthenticated(): boolean {
		return this.currentDeployment?.user !== undefined;
	}

	/**
	 * Change to a fully authenticated deployment (with user).
	 * Use this when you already have the user from a successful login.
	 */
	public async changeDeployment(
		deployment: DeploymentWithAuth & { user: User },
	): Promise<void> {
		this.setDeploymentCore(deployment);

		this.refreshWorkspaces();
		await this.persistDeployment(deployment);
	}

	/**
	 * Set deployment without requiring authentication.
	 * Immediately tries to fetch user and upgrade to authenticated state.
	 * Use this for startup or when you don't have the user yet.
	 */
	public async setDeploymentWithoutAuth(
		deployment: Deployment & { token?: string },
	): Promise<void> {
		this.setDeploymentCore({ ...deployment });

		await this.tryFetchAndUpgradeUser();
	}

	private setDeploymentCore(deployment: DeploymentWithAuth): void {
		if (deployment.token === undefined) {
			this.client.setHost(deployment.url);
		} else {
			this.client.setCredentials(deployment.url, deployment.token);
		}
		this.registerAuthListener(deployment.safeHostname);
		this.currentDeployment = { ...deployment };
		this.updateAuthContexts(deployment.user);
	}

	/**
	 * Log out from the current deployment.
	 */
	public async logout(): Promise<void> {
		this.client.setCredentials(undefined, undefined);

		this.authListenerDisposable?.dispose();
		this.authListenerDisposable = undefined;
		this.currentDeployment = null;

		this.updateAuthContexts(undefined);
		this.refreshWorkspaces();
		await this.secretsManager.setCurrentDeployment(undefined);
	}

	public dispose(): void {
		this.authListenerDisposable?.dispose();
		this.crossWindowSyncDisposable?.dispose();
	}

	private subscribeToCrossWindowChanges(): void {
		this.crossWindowSyncDisposable =
			this.secretsManager.onDidChangeCurrentDeployment(
				async ({ deployment }) => {
					if (this.isAuthenticated()) {
						// Ignore if we are already authenticated
						return;
					}

					this.logger.info("Deployment changed from another window");
					if (deployment) {
						const auth = await this.secretsManager.getSessionAuth(
							deployment.safeHostname,
						);
						await this.setDeploymentWithoutAuth({
							...deployment,
							token: auth?.token,
						});
					}
				},
			);
	}

	/**
	 * Register auth listener for the given deployment hostname.
	 * Updates credentials when they change (token refresh, cross-window sync).
	 */
	private registerAuthListener(safeHostname: string): void {
		this.authListenerDisposable?.dispose();

		this.logger.debug("Registering auth listener for hostname", safeHostname);
		this.authListenerDisposable = this.secretsManager.onDidChangeSessionAuth(
			safeHostname,
			async (auth) => {
				if (auth) {
					if (this.currentDeployment?.safeHostname !== safeHostname) {
						return;
					}

					this.client.setCredentials(this.currentDeployment.url, auth.token);

					// If we don't have a user yet, try to fetch one
					if (!this.currentDeployment?.user) {
						await this.tryFetchAndUpgradeUser();
					}
				}
			},
		);
	}

	/**
	 * Try to fetch the authenticated user and upgrade the deployment state.
	 */
	private async tryFetchAndUpgradeUser(): Promise<void> {
		if (!this.currentDeployment || this.currentDeployment.user) {
			return;
		}

		try {
			const user = await this.client.getAuthenticatedUser();
			this.currentDeployment = { ...this.currentDeployment, user };
			this.updateAuthContexts(user);
			this.refreshWorkspaces();

			// Persist with user
			await this.persistDeployment(this.currentDeployment);
		} catch (e) {
			this.logger.warn("Failed to fetch user:", e);
		}
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
			provider.fetchAndRefresh();
		}
	}

	/**
	 * Persist deployment to storage for cross-window sync.
	 */
	private async persistDeployment(
		deployment: DeploymentWithAuth,
	): Promise<void> {
		await this.secretsManager.setCurrentDeployment(deployment);
		await this.mementoManager.addToUrlHistory(deployment.url);
	}
}
