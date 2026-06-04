import * as vscode from "vscode";

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

import {
	DeploymentSchema,
	type Deployment,
	type DeploymentWithAuth,
} from "./types";

import type { User } from "coder/site/src/api/typesGenerated";

import type {
	WorkspaceSessionSnapshot,
	WorkspaceSessionState,
} from "../workspace/session";

type DeploymentSessionSnapshot =
	| {
			readonly kind: "signedOut";
			readonly revision: number;
			readonly deployment: Deployment | null;
	  }
	| {
			readonly kind: "signedIn";
			readonly revision: number;
			readonly deployment: Deployment;
			readonly user: User;
	  };

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

	#session: DeploymentSessionSnapshot = {
		kind: "signedOut",
		revision: 0,
		deployment: null,
	};
	readonly #onDidChangeWorkspaceSession =
		new vscode.EventEmitter<WorkspaceSessionSnapshot>();
	public readonly onDidChange = this.#onDidChangeWorkspaceSession.event;
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
		return this.#session.deployment;
	}

	public getCurrentUserId(): string | undefined {
		return this.#session.kind === "signedIn"
			? this.#session.user.id
			: undefined;
	}

	public getSnapshot(): WorkspaceSessionSnapshot {
		if (this.#session.kind === "signedIn") {
			return {
				kind: "signedIn",
				revision: this.#session.revision,
				userId: this.#session.user.id,
			};
		}
		return { kind: "signedOut", revision: this.#session.revision };
	}

	/**
	 * Check if we have an authenticated deployment (does not guarantee that the current auth data is valid).
	 */
	public isAuthenticated(): boolean {
		return this.#session.kind === "signedIn";
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
		const sessionBefore = this.#session;
		const token =
			deployment.token ??
			(await this.secretsManager.getSessionAuth(deployment.safeHostname))
				?.token;
		const tempClient = CoderApi.create(deployment.url, token, this.logger);

		try {
			const user = await tempClient.getAuthenticatedUser();
			if (this.#hasStateChangedSince(sessionBefore)) {
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
	#hasStateChangedSince(sessionBefore: DeploymentSessionSnapshot): boolean {
		return (
			this.#disposed ||
			this.isAuthenticated() ||
			this.#session !== sessionBefore
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

		const ourRef = this.setSignedIn(deploymentWithoutAuth, deployment.user);
		// Register before OAuth setup so background token refresh can update client credentials.
		this.registerAuthListener();
		this.updateAuthContexts(deployment.user);

		await this.oauthSessionManager.setDeployment(deploymentWithoutAuth);
		// Bail if a concurrent write took over during the await.
		if (this.#session !== ourRef) {
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
			this.#session.deployment?.safeHostname,
		);
		const wasAuthenticated = this.isAuthenticated();
		this.#authListenerDisposable?.dispose();
		this.#authListenerDisposable = undefined;
		this.setSignedOut(null);
		this.clearSessionSideEffects();
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
		this.setSignedOut(this.#session.deployment);
		this.clearSessionSideEffects();
		if (wasAuthenticated) {
			this.deploymentTelemetry.suspended(reason);
		}
	}

	private clearSessionSideEffects(): void {
		this.oauthSessionManager.clearDeployment();
		this.client.setCredentials(undefined, undefined);
		this.updateAuthContexts(undefined);
	}

	public dispose(): void {
		this.#disposed = true;
		this.#authListenerDisposable?.dispose();
		this.#authConfigDisposable?.dispose();
		this.#crossWindowSyncDisposable?.dispose();
		this.#onDidChangeWorkspaceSession.dispose();
	}

	/**
	 * Register auth listener for the current deployment.
	 * Updates credentials when they change (token refresh, cross-window sync).
	 * Also handles recovery from suspended session state.
	 */
	private registerAuthListener(): void {
		if (!this.#session.deployment) {
			return;
		}

		// Capture hostname at registration time for the guard clause
		const safeHostname = this.#session.deployment.safeHostname;

		this.#authListenerDisposable?.dispose();
		this.logger.debug("Registering auth listener for hostname", safeHostname);
		this.#authListenerDisposable = this.secretsManager.onDidChangeSessionAuth(
			safeHostname,
			async (auth) => {
				if (this.#session.deployment?.safeHostname !== safeHostname) {
					return;
				}

				if (auth) {
					if (this.isAuthenticated()) {
						await this.verifyAndUpdateAuthenticatedSession({
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

	private async verifyAndUpdateAuthenticatedSession(
		deployment: Deployment & { token: string },
	): Promise<void> {
		const sessionBefore = this.#session;
		const tempClient = CoderApi.create(
			deployment.url,
			deployment.token,
			this.logger,
		);

		try {
			const user = await tempClient.getAuthenticatedUser();
			if (this.#disposed || this.#session !== sessionBefore) {
				return;
			}
			await this.setDeployment({ ...deployment, user });
		} catch (e) {
			this.logger.warn("Failed to authenticate updated session:", e);
		} finally {
			tempClient.dispose();
		}
	}

	private setSignedIn(
		deployment: Deployment,
		user: User,
	): DeploymentSessionSnapshot {
		this.#session = {
			kind: "signedIn",
			revision: this.#session.revision + 1,
			deployment,
			user,
		};
		this.#onDidChangeWorkspaceSession.fire(this.getSnapshot());
		return this.#session;
	}

	private setSignedOut(
		deployment: Deployment | null,
	): DeploymentSessionSnapshot {
		this.#session = {
			kind: "signedOut",
			revision: this.#session.revision + 1,
			deployment,
		};
		this.#onDidChangeWorkspaceSession.fire(this.getSnapshot());
		return this.#session;
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
				const snapshot = this.#session.deployment;
				if (this.#disposed || !snapshot || this.isAuthenticated()) {
					return;
				}
				this.logger.debug(
					"Authentication settings changed after session suspended, recovering",
				);
				const recovered = await this.recoverDeployment(snapshot, "auth_config");
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
		const recovered = await this.verifyAndApplyDeployment(deployment);
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
