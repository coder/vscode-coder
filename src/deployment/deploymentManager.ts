import { CoderApi } from "../api/coderApi";
import {
	CONFIG_CHANGE_DEBOUNCE_MS,
	watchConfigurationChanges,
} from "../configWatcher";
import { type ServiceContainer } from "../core/container";
import { type ContextManager } from "../core/contextManager";
import { type MementoManager } from "../core/mementoManager";
import { type SecretsManager } from "../core/secretsManager";
import {
	DeploymentTelemetry,
	type DeploymentRecoveryTrigger,
	type DeploymentSuspendReason,
} from "../instrumentation/deployment";
import { type Logger } from "../logging/logger";
import { type OAuthSessionManager } from "../oauth/sessionManager";
import { getAuthConfigWatchSettings } from "../settings/authConfig";
import { type TelemetryService } from "../telemetry/service";

import { SessionStore, type SessionData } from "./sessionStore";
import {
	DeploymentSchema,
	type Deployment,
	type DeploymentWithAuth,
} from "./types";

import type { User } from "coder/site/src/api/typesGenerated";
import type * as vscode from "vscode";

import type {
	WorkspaceSessionSnapshot,
	WorkspaceSessionState,
} from "../workspace/session";

/**
 * Manages deployment state for the extension.
 *
 * Centralizes:
 * - In-memory deployment state (url, label, token, user)
 * - Client credential updates
 * - OAuth session management
 * - Auth listener registration
 * - Context updates (coder.authenticated, coder.isOwner)
 * - Cross-window sync handling
 */
export class DeploymentManager
	implements vscode.Disposable, WorkspaceSessionState
{
	private readonly secretsManager: SecretsManager;
	private readonly mementoManager: MementoManager;
	private readonly contextManager: ContextManager;
	private readonly logger: Logger;
	private readonly telemetryService: TelemetryService;
	private readonly deploymentTelemetry: DeploymentTelemetry;

	readonly #sessionStore = new SessionStore();
	public readonly onDidChange = this.#sessionStore.onDidChange;
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
	) {
		this.secretsManager = serviceContainer.getSecretsManager();
		this.mementoManager = serviceContainer.getMementoManager();
		this.contextManager = serviceContainer.getContextManager();
		this.logger = serviceContainer.getLogger();
		this.telemetryService = serviceContainer.getTelemetryService();
		this.deploymentTelemetry = new DeploymentTelemetry(this.telemetryService);
	}

	public static create(
		serviceContainer: ServiceContainer,
		client: CoderApi,
		oauthSessionManager: OAuthSessionManager,
	): DeploymentManager {
		const manager = new DeploymentManager(
			serviceContainer,
			client,
			oauthSessionManager,
		);
		manager.subscribeToAuthConfigChanges();
		manager.subscribeToCrossWindowChanges();
		return manager;
	}

	/**
	 * Get the current deployment state.
	 */
	public getCurrentDeployment(): Deployment | null {
		return this.#sessionStore.current.deployment;
	}

	public getSnapshot(): WorkspaceSessionSnapshot {
		return this.#sessionStore.getSnapshot();
	}

	/**
	 * Check if we have an authenticated deployment (does not guarantee that the current auth data is valid).
	 */
	public isAuthenticated(): boolean {
		return this.#sessionStore.current.kind === "signedIn";
	}

	/**
	 * Verify credentials and apply the deployment on success, signing in. Used
	 * for fresh logins and for un-suspending a session once auth settings or a
	 * token become valid again. Bails if state moved during the verify (logout,
	 * another login, dispose), so callers don't need a race guard.
	 */
	public async verifyAndApplySession(
		deployment: Deployment & { token?: string },
	): Promise<boolean> {
		const sessionBefore = this.#sessionStore.current;
		const token =
			deployment.token ??
			(await this.secretsManager.getSessionAuth(deployment.safeHostname))
				?.token;

		try {
			const user = await this.#verifyCredentials(deployment.url, token);
			if (this.#hasStateChangedSince(sessionBefore)) {
				return false;
			}
			await this.setDeployment({ ...deployment, token, user });
			return true;
		} catch (e) {
			this.logger.warn("Failed to authenticate with deployment:", e);
			return false;
		}
	}

	/**
	 * Verify credentials with a throwaway client and return the authenticated
	 * user. Throws if the credentials are rejected.
	 */
	async #verifyCredentials(
		url: string,
		token: string | undefined,
	): Promise<User> {
		const tempClient = CoderApi.create(url, token, this.logger);
		try {
			return await tempClient.getAuthenticatedUser();
		} finally {
			tempClient.dispose();
		}
	}

	/** True if disposal, login, or a deployment switch raced our await. */
	#hasStateChangedSince(sessionBefore: SessionData): boolean {
		return (
			this.#disposed ||
			this.isAuthenticated() ||
			this.#sessionStore.current !== sessionBefore
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
		const deploymentWithoutAuth = DeploymentSchema.parse(deployment);
		this.telemetryService.setDeploymentUrl(deployment.url);
		if (deployment.token === undefined) {
			this.client.setHost(deployment.url);
		} else {
			this.client.setCredentials(deployment.url, deployment.token);
		}

		const ourRef = this.#sessionStore.signIn(
			deploymentWithoutAuth,
			deployment.user,
		);
		// Register before OAuth setup so background token refresh can update client credentials.
		this.registerAuthListener();
		this.updateAuthContexts(deployment.user);

		await this.oauthSessionManager.setDeployment(deploymentWithoutAuth);
		// Bail if a concurrent write took over during the await.
		if (this.#sessionStore.current !== ourRef) {
			return;
		}
		await this.persistDeployment(deploymentWithoutAuth);
	}

	/**
	 * Clears the current deployment.
	 */
	public async clearDeployment(reason: DeploymentSuspendReason): Promise<void> {
		this.logger.debug(
			"Clearing deployment",
			this.#sessionStore.current.deployment?.safeHostname,
		);
		const wasAuthenticated = this.isAuthenticated();
		this.#authListenerDisposable?.dispose();
		this.#authListenerDisposable = undefined;
		this.#sessionStore.signOut(null);
		this.clearSideEffects();
		this.telemetryService.setDeploymentUrl("");
		if (wasAuthenticated) {
			this.deploymentTelemetry.suspended(reason);
		}

		await this.secretsManager.setCurrentDeployment(undefined);
	}

	/**
	 * Suspend session: shows logged-out state but keeps deployment for easy re-login.
	 * Auth listener remains active so recovery can happen automatically if tokens update.
	 */
	public suspendSession(reason: DeploymentSuspendReason): void {
		const wasAuthenticated = this.isAuthenticated();
		this.#sessionStore.signOut(this.#sessionStore.current.deployment);
		this.clearSideEffects();
		if (wasAuthenticated) {
			this.deploymentTelemetry.suspended(reason);
		}
	}

	private clearSideEffects(): void {
		this.oauthSessionManager.clearDeployment();
		this.client.setCredentials(undefined, undefined);
		this.updateAuthContexts(undefined);
	}

	public dispose(): void {
		this.#disposed = true;
		this.#authListenerDisposable?.dispose();
		this.#authConfigDisposable?.dispose();
		this.#crossWindowSyncDisposable?.dispose();
		this.#sessionStore.dispose();
	}

	/**
	 * Register auth listener for the current deployment.
	 * Updates credentials when they change (token refresh, cross-window sync).
	 * Also handles recovery from suspended session state.
	 */
	private registerAuthListener(): void {
		const deployment = this.#sessionStore.current.deployment;
		if (!deployment) {
			return;
		}

		// Capture hostname at registration time for the guard clause
		const safeHostname = deployment.safeHostname;

		this.#authListenerDisposable?.dispose();
		this.logger.debug("Registering auth listener for hostname", safeHostname);
		this.#authListenerDisposable = this.secretsManager.onDidChangeSessionAuth(
			safeHostname,
			async (auth) => {
				if (
					this.#sessionStore.current.deployment?.safeHostname !== safeHostname
				) {
					return;
				}

				if (auth) {
					if (this.isAuthenticated()) {
						await this.verifyAndUpdateSession({
							url: auth.url,
							safeHostname,
							token: auth.token,
						});
					} else {
						this.logger.debug(
							"Token updated after session suspended, recovering",
						);
						await this.recoverDeployment(
							{
								url: auth.url,
								safeHostname,
								token: auth.token,
							},
							"token_update",
						);
					}
				} else {
					await this.clearDeployment("credentials_removed");
				}
			},
		);
	}

	private async verifyAndUpdateSession(
		deployment: Deployment & { token: string },
	): Promise<void> {
		const sessionBefore = this.#sessionStore.current;
		try {
			const user = await this.#verifyCredentials(
				deployment.url,
				deployment.token,
			);
			if (this.#disposed || this.#sessionStore.current !== sessionBefore) {
				return;
			}
			await this.setDeployment({ ...deployment, user });
		} catch (e) {
			this.logger.warn("Failed to authenticate updated session:", e);
		}
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
				const deployment = this.#sessionStore.current.deployment;
				if (this.#disposed || !deployment || this.isAuthenticated()) {
					return;
				}
				this.logger.debug(
					"Authentication settings changed after session suspended, recovering",
				);
				const recovered = await this.recoverDeployment(
					deployment,
					"auth_config",
				);
				if (!recovered) {
					this.deploymentTelemetry.authConfigRecoveryFailed();
				}
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
						this.deploymentTelemetry.crossWindowDetected();
						await this.recoverDeployment(deployment, "cross_window");
					}
				},
			);
	}

	private async recoverDeployment(
		deployment: Deployment & { token?: string },
		trigger: DeploymentRecoveryTrigger,
	): Promise<boolean> {
		const recovered = await this.verifyAndApplySession(deployment);
		if (recovered) {
			this.deploymentTelemetry.recovered(trigger);
		}
		return recovered;
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
	 * Persist deployment to storage for cross-window sync.
	 */
	private async persistDeployment(deployment: Deployment): Promise<void> {
		await this.secretsManager.setCurrentDeployment(deployment);
		await this.mementoManager.addToUrlHistory(deployment.url);
	}
}
