import { isAxiosError } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";
import * as vscode from "vscode";

import { CoderApi } from "../api/coderApi";
import { usesClientCertificate } from "../api/httpAgent";
import { HttpStatusCode } from "../api/httpStatusCode";
import { openInBrowser, toSafeHost } from "../common/url";
import { CertificateError } from "../error/certificateError";
import { CrossOriginRedirectError } from "../error/crossOriginRedirectError";
import { requireSupportedServerVersion } from "../featureSet";
import { OAuthAuthorizer } from "../oauth/authorizer";
import { revokeOAuthTokens } from "../oauth/revocation";
import { buildOAuthTokenData } from "../oauth/tokens";
import { withCancellableProgress } from "../ui/progress";
import { maybeAskAuthMethod, maybeAskUrl } from "../ui/prompts";
import { vscodeProposed } from "../vscode/proposed";

import { notifyKeyringSkipped, showStoreCredentialsError } from "./credentials";

import type {
	User,
	OAuth2ClientRegistrationResponse,
} from "coder/site/src/api/typesGenerated";

import type { CliCredentialManager } from "../cli/cliCredentialManager";
import type { Deployment } from "../deployment/types";
import type {
	AuthLoginPromptTrigger,
	AuthTelemetry,
	LoginPromptReason,
} from "../instrumentation/auth";
import type { Logger } from "../logging/logger";
import type { OAuthCallback } from "../oauth/oauthCallback";
import type { MementoManager } from "../storage/mementoManager";
import type {
	OAuthTokenData,
	SecretsManager,
	SessionAuth,
} from "../storage/secretsManager";

export type LoginMethod =
	| "provided_token"
	| "stored_token"
	| "empty_token"
	| "cli_token"
	| "oauth";

type LoginAttemptResult =
	| { success: false; reason: LoginPromptReason }
	| { success: true; user: User; token: string; oauth?: OAuthTokenData };

export type LoginResult =
	| { success: false; method?: LoginMethod; reason: LoginPromptReason }
	| {
			success: true;
			method: LoginMethod;
			user: User;
			token: string;
			oauth?: OAuthTokenData;
	  };

export interface LoginOptions {
	safeHostname: string;
	url: string | undefined;
	autoLogin?: boolean;
	token?: string;
	/**
	 * A prompt already disclosed that `token` signs the user in. Ignored when
	 * a stored session would be replaced, which needs a prompt naming it.
	 */
	tokenSignInConfirmed?: boolean;
}

/** State shared by every step of one login. */
interface LoginContext {
	client: CoderApi;
	deployment: Deployment;
	isAutoLogin: boolean;
	/** The session stored for the deployment's origin when the login started. */
	stored: SessionAuth | undefined;
}

/** A token to try after the stored one, and how to ask before it switches users. */
interface FallbackToken {
	token: string;
	method: LoginMethod;
	title: string;
	detail: (username: string) => string;
}

/**
 * Coordinates login prompts across windows and prevents duplicate dialogs.
 */
export class LoginCoordinator implements vscode.Disposable {
	private loginQueue: Promise<unknown> = Promise.resolve();
	private readonly oauthAuthorizer: OAuthAuthorizer;

	constructor(
		private readonly secretsManager: SecretsManager,
		private readonly mementoManager: MementoManager,
		private readonly logger: Logger,
		private readonly cliCredentialManager: CliCredentialManager,
		private readonly authTelemetry: AuthTelemetry,
		oauthCallback: OAuthCallback,
		extensionId: string,
	) {
		this.oauthAuthorizer = new OAuthAuthorizer(
			secretsManager,
			oauthCallback,
			logger,
			extensionId,
		);
	}

	/**
	 * Direct login for callers that already have a deployment URL.
	 * Stores session auth and URL history on success.
	 */
	public ensureLoggedIn(
		options: LoginOptions & { url: string },
	): Promise<LoginResult> {
		return this.executeWithGuard(() => this.attemptLogin(options));
	}

	/**
	 * Shows dialog then login - for system-initiated auth (remote, OAuth refresh).
	 */
	public ensureLoggedInWithDialog(
		options: LoginOptions & {
			message?: string;
			detailPrefix?: string;
			trigger: AuthLoginPromptTrigger;
		},
	): Promise<LoginAttemptResult> {
		return this.authTelemetry.traceLoginPrompt(options.trigger, () =>
			this.performLoginDialog(options),
		);
	}

	private async performLoginDialog(
		options: LoginOptions & { message?: string; detailPrefix?: string },
	): Promise<LoginAttemptResult> {
		const { safeHostname, url, detailPrefix, message } = options;
		return this.executeWithGuard(async () => {
			// Show dialog promise
			const dialogPromise = vscodeProposed.window
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
				.then(async (action): Promise<LoginAttemptResult> => {
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
							return { success: false, reason: "no_url_provided" };
						}
						// Another origin's session belongs under another label.
						if (toSafeHost(newUrl) !== safeHostname) {
							vscode.window.showErrorMessage(
								`${newUrl} is a different deployment from ${safeHostname}. Sign in from the Coder sidebar to use it.`,
							);
							return { success: false, reason: "no_url_provided" };
						}

						return this.attemptLogin({
							safeHostname,
							url: newUrl,
							token: options.token,
						});
					}
					// User cancelled
					return { success: false, reason: "user_dismissed" };
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
		ctx: LoginContext,
		result: Extract<LoginResult, { success: true }>,
		registration: OAuth2ClientRegistrationResponse | undefined,
	): Promise<void> {
		const { safeHostname, url } = ctx.deployment;
		const current = await this.secretsManager.getSessionAuthForUrl(url);
		const replaced = current?.token === result.token ? undefined : current;
		// Keep a session a refresh or another window stored while this login only
		// re-checked the stored one. No stored session counts as the empty token.
		const recheckedStored = result.token === (ctx.stored?.token ?? "");
		if (recheckedStored && replaced) {
			return;
		}
		const reusedOAuth = replaced ? undefined : current?.oauth;

		await this.secretsManager.setSessionAuth(safeHostname, {
			url,
			token: result.token,
			username: result.user.username,
			oauth: result.oauth ?? reusedOAuth,
		});
		await this.mementoManager.addToUrlHistory(url);

		if (replaced?.oauth) {
			void revokeOAuthTokens(replaced, registration, this.logger);
		}

		const configs = vscode.workspace.getConfiguration();
		this.cliCredentialManager
			.storeToken(url, result.token, configs)
			.then((auth) => notifyKeyringSkipped(auth, configs))
			.catch((error) => showStoreCredentialsError(error, configs, this.logger));
	}

	/**
	 * Chains login attempts to prevent overlapping UI.
	 */
	private executeWithGuard<T extends LoginAttemptResult>(
		executeFn: () => Promise<T>,
	): Promise<T> {
		const result = this.loginQueue.then(executeFn);
		this.loginQueue = result.catch(() => {
			/* Keep chain going on error */
		});
		return result;
	}

	/**
	 * Waits for login detected from another window.
	 * Returns a promise and a dispose function to clean up the listener.
	 */
	private waitForCrossWindowLogin(safeHostname: string): {
		promise: Promise<LoginAttemptResult>;
		dispose: () => void;
	} {
		let disposable: vscode.Disposable | undefined;
		const promise = new Promise<LoginAttemptResult>((resolve) => {
			disposable = this.secretsManager.onDidChangeSessionAuth(
				safeHostname,
				async (auth) => {
					if (auth) {
						const client = CoderApi.create(auth.url, auth.token, this.logger);
						try {
							const user = await client.getAuthenticatedUser();
							// Stop listening only on success; a bad token shouldn't
							// drop us off the bus for a follow-up valid write.
							disposable?.dispose();
							resolve({ success: true, token: auth.token, user });
						} catch {
							// Invalid token; keep listening.
						} finally {
							client.dispose();
						}
					}
				},
			);
		});
		return {
			promise,
			dispose: () => {
				disposable?.dispose();
			},
		};
	}

	/**
	 * Authenticate via OAuth or a token, prompting as needed. On success,
	 * persists the session and revokes the OAuth session it replaces.
	 */
	private async attemptLogin(
		options: LoginOptions & { url: string },
	): Promise<LoginResult> {
		const { safeHostname, url } = options;
		// Read before OAuth login replaces it; it revokes a replaced session saved
		// without its own registration.
		const registration =
			await this.secretsManager.getOAuthClientRegistration(safeHostname);
		const stored = await this.secretsManager.getSessionAuthForUrl(url);
		const ctx: LoginContext = {
			client: CoderApi.create(url, "", this.logger),
			deployment: { safeHostname, url },
			isAutoLogin: options.autoLogin ?? false,
			stored,
		};
		try {
			try {
				const buildInfo = await ctx.client.getBuildInfo();
				requireSupportedServerVersion(buildInfo.version);
			} catch (err) {
				this.showAuthError(err, ctx.isAutoLogin);
				return { success: false, reason: "auth_failed" };
			}
			const result = options.token
				? await this.loginWithProvidedToken(
						ctx,
						options.token,
						options.tokenSignInConfirmed ?? false,
					)
				: await this.runLoginAttempts(ctx);
			if (result.success) {
				await this.persistSessionAuth(ctx, result, registration);
			}
			return result;
		} finally {
			ctx.client.dispose();
		}
	}

	/**
	 * A 401 hands over to the next token source; any other failure is terminal
	 * since retrying more tokens against an erroring server would repeat it.
	 */
	private async runLoginAttempts(ctx: LoginContext): Promise<LoginResult> {
		const { client, deployment, isAutoLogin, stored } = ctx;
		// A stored empty token is re-checked by the empty-token step below.
		if (stored?.token) {
			this.logger.debug("Trying stored session token");
			const result = await this.tryTokenAuth(client, stored.token, isAutoLogin);
			if (result !== "unauthorized") {
				return withLoginMethod("stored_token", result);
			}
		}

		// Skip the extra request unless mTLS could make an empty token work.
		if (
			stored?.token === "" ||
			usesClientCertificate(vscode.workspace.getConfiguration())
		) {
			this.logger.debug("Trying empty token");
			const empty = await this.tryFallbackToken(ctx, {
				token: "",
				method: "empty_token",
				title: "Sign in without a session token?",
				detail: (username) =>
					`The deployment signs you in as "${username}" without a token`,
			});
			if (empty) {
				return empty;
			}
		}

		const cliToken = await this.readCliToken(deployment.url);
		if (cliToken && cliToken !== stored?.token) {
			this.logger.debug("Trying token from CLI credentials");
			const cli = await this.tryFallbackToken(ctx, {
				token: cliToken,
				method: "cli_token",
				title: "Sign in with the Coder CLI's session?",
				detail: (username) =>
					`The Coder CLI's session signs you in as "${username}"`,
			});
			if (cli) {
				return cli;
			}
		}

		return this.askAuthMethod(ctx);
	}

	/**
	 * Sign in with a fallback token, asking first if it replaces a stored session
	 * of another user. Undefined hands over to the next source.
	 */
	private async tryFallbackToken(
		ctx: LoginContext,
		source: FallbackToken,
	): Promise<LoginResult | undefined> {
		const { client, deployment, isAutoLogin, stored } = ctx;
		const result = await this.tryTokenAuth(client, source.token, isAutoLogin);
		if (result === "unauthorized") {
			return undefined;
		}
		if (
			result.success &&
			stored &&
			stored.token !== source.token &&
			stored.username !== result.user.username
		) {
			const confirmed = await this.confirmSignIn(
				deployment.url,
				{ title: source.title, detail: source.detail(result.user.username) },
				// Fallback tokens are tried only after the stored one failed.
				{ username: stored.username, expired: true },
			);
			if (!confirmed) {
				return undefined;
			}
		}
		return withLoginMethod(source.method, result);
	}

	/** The Coder CLI's token for `url`, if it has its own store and holds one. */
	private async readCliToken(url: string): Promise<string | undefined> {
		const configs = vscode.workspace.getConfiguration();
		if (!(await this.cliCredentialManager.hasCliStore(url, configs))) {
			return undefined;
		}
		const result = await withCancellableProgress(
			({ signal }) =>
				this.cliCredentialManager.readToken(url, configs, { signal }),
			{
				location: vscode.ProgressLocation.Notification,
				title: "Reading credentials from the Coder CLI",
				cancellable: true,
			},
		);
		return result.ok ? result.value : undefined;
	}

	/**
	 * A link token is the login intent: sign in with it or fail. Falling back
	 * to another source could silently continue as a different user.
	 */
	private async loginWithProvidedToken(
		ctx: LoginContext,
		providedToken: string,
		tokenSignInConfirmed: boolean,
	): Promise<LoginResult> {
		const { client, deployment, isAutoLogin, stored } = ctx;
		this.logger.debug("Trying provided token");
		const result = await this.tryTokenAuth(client, providedToken, isAutoLogin);
		if (result === "unauthorized") {
			this.showAuthError(
				new Error("The token in the link is invalid or expired."),
				isAutoLogin,
			);
			return {
				success: false,
				method: "provided_token",
				reason: "auth_failed",
			};
		}
		if (result.success) {
			// Silent when the link repeats the same user on the same origin, or an
			// earlier prompt confirmed a sign-in that replaces nothing.
			const silent =
				stored?.username === result.user.username ||
				(stored === undefined && tokenSignInConfirmed);
			if (!silent) {
				// Checked silently, only to word the prompt.
				const expired =
					stored?.token !== undefined &&
					(await this.tryTokenAuth(client, stored.token, true)) ===
						"unauthorized";
				const confirmed = await this.confirmSignIn(
					deployment.url,
					{
						title: "Sign in with the token from the link?",
						detail: `The link contains a token that signs you in as "${result.user.username}"`,
					},
					stored && { username: stored.username, expired },
				);
				if (!confirmed) {
					return { success: false, reason: "user_dismissed" };
				}
			}
		}
		return withLoginMethod("provided_token", result);
	}

	/** Last resort: ask the user how to authenticate. */
	private async askAuthMethod(ctx: LoginContext): Promise<LoginResult> {
		const authMethod = await maybeAskAuthMethod(ctx.client, this.logger);
		switch (authMethod) {
			case "oauth":
				return withLoginMethod(
					"oauth",
					await this.loginWithOAuth(ctx.deployment),
				);
			case "legacy": {
				const result = await this.loginWithToken(ctx.client);
				const method =
					result.success && result.token === "" ? "empty_token" : "cli_token";
				return withLoginMethod(method, result);
			}
			case undefined:
				return { success: false, reason: "user_dismissed" };
		}
	}

	/** Ask before a token the user did not enter here signs them in. */
	private async confirmSignIn(
		url: string,
		prompt: { title: string; detail: string },
		previousSession:
			| { username: string | undefined; expired: boolean }
			| undefined,
	): Promise<boolean> {
		const previous = previousSession?.username
			? ` for "${previousSession.username}"`
			: "";
		const replacing = previousSession
			? `, replacing your ${previousSession.expired ? "expired" : "current"} session${previous}`
			: "";
		const action = await vscodeProposed.window.showWarningMessage(
			prompt.title,
			{
				useCustom: true,
				modal: true,
				detail: `${url}\n\n${prompt.detail}${replacing}.`,
			},
			"Sign In",
		);
		return action === "Sign In";
	}

	/**
	 * Returns 'unauthorized' on 401 to signal trying next token source.
	 */
	private async tryTokenAuth(
		client: CoderApi,
		token: string,
		isAutoLogin: boolean,
	): Promise<LoginAttemptResult | "unauthorized"> {
		client.setSessionToken(token);
		try {
			const user = await client.getAuthenticatedUser();
			return { success: true, token, user };
		} catch (err) {
			if (
				isAxiosError(err) &&
				err.response?.status === HttpStatusCode.UNAUTHORIZED
			) {
				return "unauthorized";
			}
			this.showAuthError(err, isAutoLogin);
			return { success: false, reason: "auth_failed" };
		}
	}

	/**
	 * Shows auth error via dialog or logs it for autoLogin.
	 */
	private showAuthError(err: unknown, isAutoLogin: boolean): void {
		const message = getErrorMessage(err, "no response from the server");
		if (isAutoLogin) {
			this.logger.warn("Failed to log in to Coder server:", message);
		} else if (err instanceof CertificateError) {
			void err.showNotification("Failed to log in to Coder server", {
				modal: true,
			});
		} else if (err instanceof CrossOriginRedirectError) {
			void err.showNotification("Failed to log in to Coder server");
		} else {
			void vscodeProposed.window.showErrorMessage(
				"Failed to log in to Coder server",
				{
					detail: message,
					modal: true,
					useCustom: true,
				},
			);
		}
	}

	/**
	 * Session token authentication flow.
	 */
	private async loginWithToken(client: CoderApi): Promise<LoginAttemptResult> {
		const url = client.getAxiosInstance().defaults.baseURL;
		if (!url) {
			throw new Error("No base URL set on REST client");
		}
		// This prompt is for convenience; do not error if they close it since
		// they may already have a token or already have the page opened.
		await openInBrowser(url, "/cli-auth");

		return this.promptForToken(client);
	}

	/**
	 * Tokens are checked as typed, so only a valid one can be submitted. Empty
	 * is the initial value, so it is checked only on submit; if rejected, the
	 * prompt reopens with the error, which blocks submitting it again.
	 */
	private async promptForToken(
		client: CoderApi,
		emptyTokenError?: vscode.InputBoxValidationMessage,
	): Promise<LoginAttemptResult> {
		let validated: ValidToken | undefined;
		const submitted = await vscode.window.showInputBox({
			title: "Coder API Key",
			password: true,
			placeHolder: "Paste your API key.",
			ignoreFocusOut: true,
			validateInput: async (value) => {
				if (value === "") {
					return emptyTokenError;
				}
				const check = await checkToken(client, value);
				if (!check.valid) {
					return check.error;
				}
				validated = check;
				return undefined;
			},
		});

		if (submitted === undefined) {
			return { success: false, reason: "user_dismissed" };
		}
		if (submitted === "") {
			const check = await checkToken(client, "");
			return check.valid
				? { success: true, user: check.user, token: "" }
				: this.promptForToken(client, check.error);
		}
		// Guards against a user validated for an earlier value.
		if (validated?.token !== submitted) {
			return { success: false, reason: "user_dismissed" };
		}
		return { success: true, user: validated.user, token: submitted };
	}

	/**
	 * OAuth authentication flow.
	 */
	private async loginWithOAuth(
		deployment: Deployment,
	): Promise<LoginAttemptResult> {
		try {
			this.logger.debug("Starting OAuth authentication");

			const { tokenResponse, user, registration } =
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "Authenticating",
						cancellable: true,
					},
					async (progress, cancellationToken) =>
						await this.oauthAuthorizer.login(
							deployment,
							progress,
							cancellationToken,
						),
				);

			return {
				success: true,
				token: tokenResponse.access_token,
				user,
				oauth: buildOAuthTokenData(tokenResponse, registration),
			};
		} catch (error) {
			const title = "OAuth authentication failed";
			this.logger.error(title, error);
			if (error instanceof CertificateError) {
				void error.showNotification(title);
			} else if (error instanceof CrossOriginRedirectError) {
				void error.showNotification(title);
			} else {
				// A modal's `detail` is plain text; a notification message would render
				// server-supplied markdown links, including `command:` links.
				void vscodeProposed.window.showErrorMessage(title, {
					detail: getErrorMessage(error, "Unknown error"),
					modal: true,
					useCustom: true,
				});
			}
			return { success: false, reason: "auth_failed" };
		}
	}

	public dispose(): void {
		this.oauthAuthorizer.dispose();
	}
}

function withLoginMethod(
	method: LoginMethod,
	result: LoginAttemptResult,
): LoginResult {
	return { ...result, method };
}

interface ValidToken {
	valid: true;
	token: string;
	user: User;
}

type TokenCheck =
	| ValidToken
	| { valid: false; error: vscode.InputBoxValidationMessage };

/** Sign in with `token`; a failure carries the error to show under the prompt. */
async function checkToken(
	client: CoderApi,
	token: string,
): Promise<TokenCheck> {
	client.setSessionToken(token);
	try {
		const user = await client.getAuthenticatedUser();
		return { valid: true, token, user };
	} catch (err) {
		if (err instanceof CertificateError) {
			// Also notify, since users sometimes miss the message under the prompt.
			void err.showNotification();
			return invalidToken(err.detail);
		}
		return invalidToken(
			`Failed to authenticate: ${getErrorMessage(err, "no response from the server")}`,
		);
	}
}

function invalidToken(message: string): TokenCheck {
	return {
		valid: false,
		error: { message, severity: vscode.InputBoxValidationSeverity.Error },
	};
}
