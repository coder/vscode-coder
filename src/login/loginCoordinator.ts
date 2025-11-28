import { getErrorMessage } from "coder/site/src/api/errors";
import * as vscode from "vscode";

import { CoderApi } from "../api/coderApi";
import { needToken } from "../api/utils";
import { type Deployment } from "../core/deployment";
import { type MementoManager } from "../core/mementoManager";
import { type SecretsManager } from "../core/secretsManager";
import { CertificateError } from "../error";
import { type Logger } from "../logging/logger";
import { maybeAskAuthMethod, maybeAskUrl } from "../promptUtils";

import type { User } from "coder/site/src/api/typesGenerated";

import type { OAuthSessionManager } from "../oauth/sessionManager";

interface LoginResult {
	success: boolean;
	user?: User;
	token?: string;
}

interface LoginOptions {
	label: string;
	url: string | undefined;
	oauthSessionManager: OAuthSessionManager;
	autoLogin?: boolean;
}

/**
 * Coordinates login prompts across windows and prevents duplicate dialogs.
 */
export class LoginCoordinator {
	private readonly inProgressLogins = new Map<string, Promise<LoginResult>>();

	constructor(
		private readonly secretsManager: SecretsManager,
		private readonly mementoManager: MementoManager,
		private readonly vscodeProposed: typeof vscode,
		private readonly logger: Logger,
	) {}

	/**
	 * Direct login - for user-initiated login via commands.
	 * Stores session auth and URL history on success.
	 */
	public async promptForLogin(
		options: LoginOptions & { url: string },
	): Promise<LoginResult> {
		const { label, url, oauthSessionManager } = options;
		return this.executeWithGuard(label, async () => {
			const result = await this.attemptLogin(
				{ label, url },
				options.autoLogin ?? false,
				oauthSessionManager,
			);

			await this.persistSessionAuth(result, label, url);

			return result;
		});
	}

	/**
	 * Shows dialog then login - for system-initiated auth (remote, OAuth refresh).
	 */
	public async promptForLoginWithDialog(
		options: LoginOptions & { message?: string; detailPrefix?: string },
	): Promise<LoginResult> {
		const { label, url, detailPrefix, message, oauthSessionManager } = options;
		return this.executeWithGuard(label, () => {
			// Show dialog promise
			const dialogPromise = this.vscodeProposed.window
				.showErrorMessage(
					message || "Authentication Required",
					{
						modal: true,
						useCustom: true,
						detail:
							(detailPrefix || `Authentication needed for ${label}.`) +
							"\n\nIf you've already logged in, you may close this dialog.",
					},
					"Login",
				)
				.then(async (action) => {
					if (action === "Login") {
						// Proceed with the login flow, handling logging in from another window
						const storedUrl = await this.secretsManager.getUrl(label);
						const newUrl = await maybeAskUrl(
							this.mementoManager,
							url,
							storedUrl,
						);
						if (!newUrl) {
							throw new Error("URL must be provided");
						}

						const result = await this.attemptLogin(
							{ url: newUrl, label },
							false,
							oauthSessionManager,
						);

						await this.persistSessionAuth(result, label, newUrl);

						return result;
					} else {
						// User cancelled
						return { success: false };
					}
				});

			// Race between user clicking login and cross-window detection
			return Promise.race([dialogPromise, this.waitForCrossWindowLogin(label)]);
		});
	}

	private async persistSessionAuth(
		result: LoginResult,
		label: string,
		url: string,
	): Promise<void> {
		if (result.success && result.token) {
			await this.secretsManager.setSessionAuth(label, {
				url,
				token: result.token,
			});
			await this.mementoManager.addToUrlHistory(url);
		}
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
			const disposable = this.secretsManager.onDidChangeSessionAuth(
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
		const needsToken = needToken(vscode.workspace.getConfiguration());
		const client = CoderApi.create(deployment.url, "", this.logger);

		let storedToken: string | undefined;
		if (needsToken) {
			storedToken = await this.secretsManager.getSessionToken(deployment.label);
			if (storedToken) {
				client.setSessionToken(storedToken);
			}
		}

		// Attempt authentication with current credentials (token or mTLS)
		try {
			const user = await client.getAuthenticatedUser();
			// Return the token that was used (empty string for mTLS since
			// the `vscodessh` command currently always requires a token file)
			return { success: true, token: storedToken ?? "", user };
		} catch (err) {
			if (needsToken) {
				// For token auth: silently continue to prompt for new credentials
			} else {
				// For mTLS: show error and abort (no credentials to prompt for)
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
				return { success: false };
			}
		}

		const authMethod = await maybeAskAuthMethod(client);
		switch (authMethod) {
			case "oauth":
				return this.loginWithOAuth(client, oauthSessionManager, deployment);
			case "legacy":
				return this.loginWithToken(client);
			case undefined:
				return { success: false }; // User aborted
		}
	}

	/**
	 * Session token authentication flow.
	 */
	private async loginWithToken(client: CoderApi): Promise<LoginResult> {
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
			const title = "OAuth authentication failed";
			this.logger.error(title, error);
			if (error instanceof CertificateError) {
				error.showNotification(title);
			} else {
				vscode.window.showErrorMessage(
					`${title}: ${getErrorMessage(error, "Unknown error")}`,
				);
			}
			return { success: false };
		}
	}
}
