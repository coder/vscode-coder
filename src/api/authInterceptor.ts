import { type AxiosError, isAxiosError } from "axios";

import { OAuthError } from "../oauth/errors";
import { toSafeHost } from "../util";

import type * as vscode from "vscode";

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
	private authRequiredPromise: Promise<boolean> | null = null;

	constructor(
		private readonly client: CoderApi,
		private readonly logger: Logger,
		private readonly oauthSessionManager: OAuthSessionManager,
		private readonly secretsManager: SecretsManager,
		private readonly onAuthRequired?: AuthRequiredHandler,
	) {
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

	private async handle401Error(
		error: AxiosError,
		hostname: string,
	): Promise<unknown> {
		this.logger.debug("Received 401 response, attempting recovery");

		if (await this.oauthSessionManager.isLoggedInWithOAuth(hostname)) {
			try {
				const newTokens = await this.oauthSessionManager.refreshToken();
				this.client.setSessionToken(newTokens.access_token);
				this.logger.debug("Token refresh successful, retrying request");
				return this.retryRequest(error, newTokens.access_token);
			} catch (refreshError) {
				if (refreshError instanceof OAuthError) {
					const msg = `Token refresh failed: ${refreshError.message}`;
					if (refreshError.requiresReAuth) {
						this.logger.warn(msg);
					} else {
						this.logger.error(msg);
					}
				} else {
					this.logger.error("Token refresh failed:", refreshError);
				}
			}
		}

		if (this.onAuthRequired) {
			const success = await this.executeAuthRequired(hostname);
			if (success) {
				const auth = await this.secretsManager.getSessionAuth(hostname);
				if (auth) {
					this.logger.debug("Re-authentication successful, retrying request");
					return this.retryRequest(error, auth.token);
				}
			}
		}

		throw error;
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

		this.logger.debug("Triggering re-authentication");
		this.authRequiredPromise = this.onAuthRequired!(hostname);

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
