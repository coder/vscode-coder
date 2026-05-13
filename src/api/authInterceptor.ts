import { type AxiosError, isAxiosError } from "axios";

import { AuthTelemetry } from "../instrumentation/auth";
import { OAuthError } from "../oauth/errors";
import { toSafeHost } from "../util";

import type * as vscode from "vscode";

import type { ServiceContainer } from "../core/container";
import type { SecretsManager } from "../core/secretsManager";
import type { Logger } from "../logging/logger";
import type { RequestConfigWithMeta } from "../logging/types";
import type { OAuthSessionManager } from "../oauth/sessionManager";

import type { CoderApi } from "./coderApi";

const coderSessionTokenHeader = "Coder-Session-Token";

/**
 * Callback invoked when authentication is required.
 * Returns true if user successfully re-authenticated.
 */
export type AuthRequiredHandler = (hostname: string) => Promise<boolean>;

/**
 * Intercepts 401 responses and handles re-authentication.
 *
 * Always attached to the axios instance. Handles both OAuth (automatic refresh)
 * and non-OAuth (interactive re-auth via callback) authentication failures.
 */
export class AuthInterceptor implements vscode.Disposable {
	private readonly interceptorId: number;
	private readonly authTelemetry: AuthTelemetry;
	private readonly logger: Logger;
	private readonly secretsManager: SecretsManager;
	private authRequiredPromise: Promise<boolean> | null = null;

	constructor(
		private readonly client: CoderApi,
		private readonly oauthSessionManager: OAuthSessionManager,
		container: ServiceContainer,
		private readonly onAuthRequired?: AuthRequiredHandler,
	) {
		this.logger = container.getLogger();
		this.secretsManager = container.getSecretsManager();
		this.authTelemetry = new AuthTelemetry(container.getTelemetryService());
		this.interceptorId = this.client
			.getAxiosInstance()
			.interceptors.response.use(
				(r) => r,
				(error: unknown) => this.handleError(error),
			);
		this.logger.debug("Auth interceptor attached");
	}

	private async handleError(error: unknown): Promise<unknown> {
		if (!isAxiosError(error)) {
			throw error;
		}

		if (error.config) {
			const config = error.config as { _retryAttempted?: boolean };
			if (config._retryAttempted) {
				throw error;
			}
		}

		if (error.response?.status !== 401) {
			throw error;
		}

		const baseUrl = this.client.getHost();
		if (!baseUrl) {
			throw error;
		}
		const hostname = toSafeHost(baseUrl);

		return this.handle401Error(error, hostname);
	}

	/**
	 * `auth.intercept_401` wraps recovery + retry, so the span emits after the
	 * retry resolves; the receive-time is `timestamp - durationMs`.
	 *
	 * TODO(#925): once `Span.log()` lands, emit a correlated `auth.intercept_401.received`
	 * log here at decision time so analytics can see the receive moment
	 * directly without back-computing.
	 */
	private handle401Error(
		error: AxiosError,
		hostname: string,
	): Promise<unknown> {
		this.logger.debug("Received 401 response, attempting recovery");
		return this.authTelemetry.traceIntercept401(async (setRecovery) => {
			const newToken = (await this.oauthSessionManager.isLoggedInWithOAuth(
				hostname,
			))
				? await this.tryOAuthRefresh()
				: undefined;
			if (newToken) {
				setRecovery("refresh_success");
				return this.retryRequest(error, newToken);
			} else if (this.onAuthRequired) {
				setRecovery("login_required");
				const success = await this.executeAuthRequired(hostname);
				const auth = success
					? await this.secretsManager.getSessionAuth(hostname)
					: undefined;
				if (auth) {
					this.logger.debug("Re-authentication successful, retrying request");
					return this.retryRequest(error, auth.token);
				}
				throw error;
			} else {
				setRecovery("none");
				throw error;
			}
		});
	}

	/** Returns the new access token on success, or undefined when refresh fails. */
	private async tryOAuthRefresh(): Promise<string | undefined> {
		try {
			const newTokens = await this.oauthSessionManager.refreshToken();
			this.client.setSessionToken(newTokens.access_token);
			this.logger.debug("Token refresh successful, retrying request");
			return newTokens.access_token;
		} catch (refreshError) {
			if (!(refreshError instanceof OAuthError)) {
				this.logger.error("Token refresh failed:", refreshError);
			} else if (refreshError.requiresReAuth) {
				this.logger.warn(`Token refresh failed: ${refreshError.message}`);
			} else {
				this.logger.error(`Token refresh failed: ${refreshError.message}`);
			}
			return undefined;
		}
	}

	/**
	 * Execute auth required callback with deduplication.
	 * Multiple concurrent 401s will share the same promise.
	 */
	private async executeAuthRequired(hostname: string): Promise<boolean> {
		if (this.authRequiredPromise) {
			this.logger.debug(
				"Auth callback already in progress, waiting for result",
			);
			return this.authRequiredPromise;
		}

		if (!this.onAuthRequired) {
			throw new Error("No auth handler registered");
		}

		this.logger.debug("Triggering re-authentication");
		this.authRequiredPromise = this.onAuthRequired(hostname);

		try {
			return await this.authRequiredPromise;
		} finally {
			this.authRequiredPromise = null;
		}
	}

	private retryRequest(error: AxiosError, token: string): Promise<unknown> {
		if (!error.config) {
			throw error;
		}

		const config = error.config as RequestConfigWithMeta & {
			_retryAttempted?: boolean;
		};
		config._retryAttempted = true;
		config.headers[coderSessionTokenHeader] = token;
		return this.client.getAxiosInstance().request(config);
	}

	public dispose(): void {
		this.client
			.getAxiosInstance()
			.interceptors.response.eject(this.interceptorId);
		this.logger.debug("Auth interceptor detached");
	}
}
