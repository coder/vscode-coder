import { isAxiosError } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";
import * as vscode from "vscode";

import { CoderApi } from "../api/coderApi";
import { needToken } from "../api/utils";
import { CertificateError } from "../error";
import { maybeAskUrl } from "../promptUtils";

import type { User } from "coder/site/src/api/typesGenerated";

import type { MementoManager } from "../core/mementoManager";
import type { SecretsManager } from "../core/secretsManager";
import type { Deployment } from "../deployment/types";
import type { Logger } from "../logging/logger";

type LoginResult =
	| { success: false }
	| { success: true; user?: User; token: string };

interface LoginOptions {
	safeHostname: string;
	url: string | undefined;
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
	public async ensureLoggedIn(
		options: LoginOptions & { url: string },
	): Promise<LoginResult> {
		const { safeHostname, url } = options;
		return this.executeWithGuard(safeHostname, async () => {
			const result = await this.attemptLogin(
				{ safeHostname, url },
				options.autoLogin ?? false,
			);

			await this.persistSessionAuth(result, safeHostname, url);

			return result;
		});
	}

	/**
	 * Shows dialog then login - for system-initiated auth (remote).
	 */
	public async ensureLoggedInWithDialog(
		options: LoginOptions & { message?: string; detailPrefix?: string },
	): Promise<LoginResult> {
		const { safeHostname, url, detailPrefix, message } = options;
		return this.executeWithGuard(safeHostname, async () => {
			// Show dialog promise
			const dialogPromise = this.vscodeProposed.window
				.showErrorMessage(
					message || "Authentication Required",
					{
						modal: true,
						useCustom: true,
						detail:
							(detailPrefix || `Authentication needed for ${safeHostname}.`) +
							"\n\nIf you've already logged in, you may close this dialog.",
					},
					"Login",
				)
				.then(async (action) => {
					if (action === "Login") {
						// Proceed with the login flow, handling logging in from another window
						const storedAuth =
							await this.secretsManager.getSessionAuth(safeHostname);
						const newUrl = await maybeAskUrl(
							this.mementoManager,
							url,
							storedAuth?.url,
						);
						if (!newUrl) {
							throw new Error("URL must be provided");
						}

						const result = await this.attemptLogin(
							{ url: newUrl, safeHostname },
							false,
						);

						await this.persistSessionAuth(result, safeHostname, newUrl);

						return result;
					} else {
						// User cancelled
						return { success: false } as const;
					}
				});

			// Race between user clicking login and cross-window detection
			const {
				promise: crossWindowPromise,
				dispose: disposeCrossWindowListener,
			} = this.waitForCrossWindowLogin(safeHostname);
			try {
				return await Promise.race([dialogPromise, crossWindowPromise]);
			} finally {
				disposeCrossWindowListener();
			}
		});
	}

	private async persistSessionAuth(
		result: LoginResult,
		safeHostname: string,
		url: string,
	): Promise<void> {
		// Empty token is valid for mTLS
		if (result.success) {
			await this.secretsManager.setSessionAuth(safeHostname, {
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
		safeHostname: string,
		executeFn: () => Promise<LoginResult>,
	): Promise<LoginResult> {
		const existingLogin = this.inProgressLogins.get(safeHostname);
		if (existingLogin) {
			return existingLogin;
		}

		const loginPromise = executeFn();
		this.inProgressLogins.set(safeHostname, loginPromise);

		try {
			return await loginPromise;
		} finally {
			this.inProgressLogins.delete(safeHostname);
		}
	}

	/**
	 * Waits for login detected from another window.
	 * Returns a promise and a dispose function to clean up the listener.
	 */
	private waitForCrossWindowLogin(safeHostname: string): {
		promise: Promise<LoginResult>;
		dispose: () => void;
	} {
		let disposable: vscode.Disposable | undefined;
		const promise = new Promise<LoginResult>((resolve) => {
			disposable = this.secretsManager.onDidChangeSessionAuth(
				safeHostname,
				(auth) => {
					if (auth?.token) {
						disposable?.dispose();
						resolve({ success: true, token: auth.token });
					}
				},
			);
		});
		return {
			promise,
			dispose: () => disposable?.dispose(),
		};
	}

	/**
	 * Attempt to authenticate using token, or mTLS. If necessary, prompts
	 * for authentication method and credentials. Returns the token and user upon
	 * successful authentication. Null means the user aborted or authentication
	 * failed (in which case an error notification will have been displayed).
	 */
	private async attemptLogin(
		deployment: Deployment,
		isAutoLogin: boolean,
	): Promise<LoginResult> {
		const needsToken = needToken(vscode.workspace.getConfiguration());
		const client = CoderApi.create(deployment.url, "", this.logger);

		let storedToken: string | undefined;
		if (needsToken) {
			const auth = await this.secretsManager.getSessionAuth(
				deployment.safeHostname,
			);
			storedToken = auth?.token;
			if (storedToken) {
				client.setSessionToken(storedToken);
			}
		}

		// Attempt authentication with current credentials (token or mTLS)
		try {
			if (!needsToken || storedToken) {
				const user = await client.getAuthenticatedUser();
				// Return the token that was used (empty string for mTLS since
				// the `vscodessh` command currently always requires a token file)
				return { success: true, token: storedToken ?? "", user };
			}
		} catch (err) {
			const is401 = isAxiosError(err) && err.response?.status === 401;
			if (needsToken && is401) {
				// For token auth with 401: silently continue to prompt for new credentials
			} else {
				// For mTLS or non-401 errors: show error and abort
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

		const result = await this.loginWithToken(client);
		return result;
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

		if (user) {
			return { success: true, user, token: validatedToken ?? "" };
		}

		return { success: false };
	}
}
