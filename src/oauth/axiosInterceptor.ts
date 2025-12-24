import { type AxiosError, isAxiosError } from "axios";

import type * as vscode from "vscode";

import type { CoderApi } from "../api/coderApi";
import type { SecretsManager } from "../core/secretsManager";
import type { Logger } from "../logging/logger";
import type { RequestConfigWithMeta } from "../logging/types";

import type { OAuthSessionManager } from "./sessionManager";

const coderSessionTokenHeader = "Coder-Session-Token";

/**
 * Manages OAuth interceptor lifecycle reactively based on token presence.
 *
 * Automatically attaches/detaches the interceptor when OAuth tokens appear/disappear
 * in secrets storage. This ensures the interceptor state always matches the actual
 * OAuth authentication state.
 */
export class OAuthInterceptor implements vscode.Disposable {
	private interceptorId: number | null = null;
	private tokenListener: vscode.Disposable | undefined;
	private safeHostname: string;

	private constructor(
		private readonly client: CoderApi,
		private readonly logger: Logger,
		private readonly oauthSessionManager: OAuthSessionManager,
		private readonly secretsManager: SecretsManager,
		safeHostname: string,
	) {
		this.safeHostname = safeHostname;
	}

	public static async create(
		client: CoderApi,
		logger: Logger,
		oauthSessionManager: OAuthSessionManager,
		secretsManager: SecretsManager,
		safeHostname: string,
	): Promise<OAuthInterceptor> {
		const instance = new OAuthInterceptor(
			client,
			logger,
			oauthSessionManager,
			secretsManager,
			safeHostname,
		);

		instance.setupTokenListener();
		await instance.syncWithTokenState();
		return instance;
	}

	public async setDeployment(safeHostname: string): Promise<void> {
		if (this.safeHostname === safeHostname) {
			return;
		}

		this.safeHostname = safeHostname;
		this.detach();
		this.setupTokenListener();
		await this.syncWithTokenState();
	}

	public clearDeployment(): void {
		this.tokenListener?.dispose();
		this.tokenListener = undefined;
		this.detach();
	}

	private setupTokenListener(): void {
		this.tokenListener?.dispose();

		if (!this.safeHostname) {
			this.tokenListener = undefined;
			return;
		}

		this.tokenListener = this.secretsManager.onDidChangeSessionAuth(
			this.safeHostname,
			() => {
				this.syncWithTokenState().catch((err) => {
					this.logger.error("Error syncing OAuth interceptor state:", err);
				});
			},
		);
	}

	/**
	 * Sync interceptor state with OAuth token presence.
	 * Attaches when tokens exist, detaches when they don't.
	 */
	private async syncWithTokenState(): Promise<void> {
		const isOAuth = await this.oauthSessionManager.isLoggedInWithOAuth();
		if (isOAuth && this.interceptorId === null) {
			this.attach();
		} else if (!isOAuth && this.interceptorId !== null) {
			this.detach();
		}
	}

	private attach(): void {
		if (this.interceptorId !== null) {
			return;
		}

		this.interceptorId = this.client
			.getAxiosInstance()
			.interceptors.response.use(
				(r) => r,
				(error: unknown) => this.handleError(error),
			);

		this.logger.debug("OAuth interceptor attached");
	}

	private detach(): void {
		if (this.interceptorId === null) {
			return;
		}

		this.client
			.getAxiosInstance()
			.interceptors.response.eject(this.interceptorId);
		this.interceptorId = null;
		this.logger.debug("OAuth interceptor detached");
	}

	private async handleError(error: unknown): Promise<unknown> {
		if (!isAxiosError(error)) {
			throw error;
		}

		if (error.config) {
			const config = error.config as { _oauthRetryAttempted?: boolean };
			if (config._oauthRetryAttempted) {
				throw error;
			}
		}

		if (error.response?.status === 401) {
			return this.handle401Error(error);
		}

		throw error;
	}

	private async handle401Error(error: AxiosError): Promise<unknown> {
		this.logger.info("Received 401 response, attempting token refresh");

		try {
			const newTokens = await this.oauthSessionManager.refreshToken();
			this.client.setSessionToken(newTokens.access_token);

			this.logger.info("Token refresh successful, retrying request");

			if (error.config) {
				const config = error.config as RequestConfigWithMeta & {
					_oauthRetryAttempted?: boolean;
				};
				config._oauthRetryAttempted = true;
				config.headers[coderSessionTokenHeader] = newTokens.access_token;
				return this.client.getAxiosInstance().request(config);
			}

			throw error;
		} catch (refreshError) {
			this.logger.error("Token refresh failed:", refreshError);
			throw error;
		}
	}

	public dispose(): void {
		this.tokenListener?.dispose();
		this.detach();
	}
}
