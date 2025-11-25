import { getErrorMessage } from "coder/site/src/api/errors";
import * as vscode from "vscode";

import { type Deployment } from "src/core/deployment";

import { CoderApi } from "../api/coderApi";
import { needToken } from "../api/utils";
import { type SecretsManager } from "../core/secretsManager";
import { CertificateError } from "../error";
import { type Logger } from "../logging/logger";
import { maybeAskAuthMethod } from "../promptUtils";

import type { User } from "coder/site/src/api/typesGenerated";

import type { OAuthSessionManager } from "../oauth/sessionManager";

export interface LoginResult {
	success: boolean;
	user?: User;
	token?: string;
}

export interface LoginOptions {
	deployment: Deployment;
	oauthSessionManager: OAuthSessionManager;
	autoLogin?: boolean;
	message?: string;
	detailPrefix?: string;
}

/**
 * Coordinates login prompts across windows and prevents duplicate dialogs.
 */
export class LoginCoordinator {
	private readonly inProgressLogins = new Map<string, Promise<LoginResult>>();

	constructor(
		private readonly secretsManager: SecretsManager,
		private readonly vscodeProposed: typeof vscode,
		private readonly logger: Logger,
	) {}

	/**
	 * Direct login - for user-initiated login via commands.
	 */
	public async promptForLogin(
		options: Omit<LoginOptions, "message" | "detailPrefix">,
	): Promise<LoginResult> {
		const { deployment, oauthSessionManager } = options;
		return this.executeWithGuard(options.deployment.label, async () => {
			return this.attemptLogin(
				deployment,
				options.autoLogin ?? false,
				oauthSessionManager,
			);
		});
	}

	/**
	 * Shows dialog then login - for system-initiated auth (remote, OAuth refresh).
	 */
	public async promptForLoginWithDialog(
		options: LoginOptions,
	): Promise<LoginResult> {
		const { deployment, detailPrefix, message, oauthSessionManager } = options;
		return this.executeWithGuard(deployment.label, () => {
			// Show dialog promise
			const dialogPromise = this.vscodeProposed.window
				.showErrorMessage(
					message || "Authentication Required",
					{
						modal: true,
						useCustom: true,
						detail:
							(detailPrefix ||
								`Authentication needed for ${deployment.label}.`) +
							"\n\nIf you've already logged in, you may close this dialog.",
					},
					"Login",
				)
				.then(async (action) => {
					if (action === "Login") {
						// User clicked login - proceed with login flow
						const result = await this.attemptLogin(
							deployment,
							false,
							oauthSessionManager,
						);

						if (result.success && result.token) {
							await this.secretsManager.setSessionAuth(deployment.label, {
								url: deployment.url,
								token: result.token,
							});
						}

						return result;
					} else {
						// User cancelled
						return { success: false };
					}
				});

			// Race between user clicking login and cross-window detection
			return Promise.race([
				dialogPromise,
				this.waitForCrossWindowLogin(deployment.label),
			]);
		});
	}

	/**
	 * Same-window guard wrapper.
	 */
	private async executeWithGuard(
		label: string,
		executeFn: () => Promise<LoginResult>,
	): Promise<LoginResult> {
		const existingLogin = this.inProgressLogins.get(label);
		if (existingLogin) {
			return existingLogin;
		}

		const loginPromise = executeFn();
		this.inProgressLogins.set(label, loginPromise);

		try {
			return await loginPromise;
		} finally {
			this.inProgressLogins.delete(label);
		}
	}

	/**
	 * Waits for login detected from another window.
	 */
	private async waitForCrossWindowLogin(label: string): Promise<LoginResult> {
		return new Promise((resolve) => {
			const disposable = this.secretsManager.onDidChangeDeploymentAuth(
				label,
				(auth) => {
					if (auth?.token) {
						disposable.dispose();
						resolve({ success: true, token: auth.token });
					}
				},
			);
		});
	}

	/**
	 * Attempt to authenticate using OAuth, token, or mTLS. If necessary, prompts
	 * for authentication method and credentials. Returns the token and user upon
	 * successful authentication. Null means the user aborted or authentication
	 * failed (in which case an error notification will have been displayed).
	 */
	private async attemptLogin(
		deployment: Deployment,
		isAutoLogin: boolean,
		oauthSessionManager: OAuthSessionManager,
	): Promise<LoginResult> {
		const token = await this.secretsManager.getSessionToken(deployment.label);
		const client = CoderApi.create(deployment.url, token, this.logger);
		const needsToken = needToken(vscode.workspace.getConfiguration());
		if (!needsToken || token) {
			try {
				const user = await client.getAuthenticatedUser();
				// For non-token auth, we write a blank token since the `vscodessh`
				// command currently always requires a token file.
				// For token auth, we have valid access so we can just return the user here
				return { success: true, token: needsToken && token ? token : "", user };
			} catch (err) {
				const message = getErrorMessage(err, "no response from the server");
				if (isAutoLogin) {
					this.logger.warn("Failed to log in to Coder server:", message);
				} else {
					this.vscodeProposed.window.showErrorMessage(
						"Failed to log in to Coder server",
						{
							detail: message,
							modal: true,
							useCustom: true,
						},
					);
				}
				// Invalid certificate, most likely.
				return { success: false };
			}
		}

		const authMethod = await maybeAskAuthMethod(client);
		switch (authMethod) {
			case "oauth":
				return this.loginWithOAuth(client, oauthSessionManager, deployment);
			case "legacy": {
				const initialToken =
					token ||
					(await this.secretsManager.getSessionToken(deployment.label));
				return this.loginWithToken(client, initialToken);
			}
			case undefined:
				return { success: false }; // User aborted
		}
	}

	/**
	 * Session token authentication flow.
	 */
	private async loginWithToken(
		client: CoderApi,
		initialToken: string | undefined,
	): Promise<LoginResult> {
		const url = client.getAxiosInstance().defaults.baseURL;
		if (!url) {
			throw new Error("No base URL set on REST client");
		}
		// This prompt is for convenience; do not error if they close it since
		// they may already have a token or already have the page opened.
		await vscode.env.openExternal(vscode.Uri.parse(`${url}/cli-auth`));

		// For token auth, start with the existing token in the prompt or the last
		// used token.  Once submitted, if there is a failure we will keep asking
		// the user for a new token until they quit.
		let user: User | undefined;
		const validatedToken = await vscode.window.showInputBox({
			title: "Coder API Key",
			password: true,
			placeHolder: "Paste your API key.",
			value: initialToken,
			ignoreFocusOut: true,
			validateInput: async (value) => {
				if (!value) {
					return null;
				}
				client.setSessionToken(value);
				try {
					user = await client.getAuthenticatedUser();
				} catch (err) {
					// For certificate errors show both a notification and add to the
					// text under the input box, since users sometimes miss the
					// notification.
					if (err instanceof CertificateError) {
						err.showNotification();
						return {
							message: err.x509Err || err.message,
							severity: vscode.InputBoxValidationSeverity.Error,
						};
					}
					// This could be something like the header command erroring or an
					// invalid session token.
					const message = getErrorMessage(err, "no response from the server");
					return {
						message: "Failed to authenticate: " + message,
						severity: vscode.InputBoxValidationSeverity.Error,
					};
				}
			},
		});

		if (user === undefined || validatedToken === undefined) {
			return { success: false };
		}

		return { success: true, user, token: validatedToken };
	}

	/**
	 * OAuth authentication flow.
	 */
	private async loginWithOAuth(
		client: CoderApi,
		oauthSessionManager: OAuthSessionManager,
		deployment: Deployment,
	): Promise<LoginResult> {
		try {
			this.logger.info("Starting OAuth authentication");

			const tokenResponse = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Authenticating",
					cancellable: false,
				},
				async (progress) =>
					await oauthSessionManager.login(client, deployment, progress),
			);

			// Validate token by fetching user
			client.setSessionToken(tokenResponse.access_token);
			const user = await client.getAuthenticatedUser();

			return {
				success: true,
				token: tokenResponse.access_token,
				user,
			};
		} catch (error) {
			this.logger.error("OAuth authentication failed:", error);
			vscode.window.showErrorMessage(
				`OAuth authentication failed: ${getErrorMessage(error, "Unknown error")}`,
			);
			return { success: false };
		}
	}
}
