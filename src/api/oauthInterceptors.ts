import { type AxiosError, isAxiosError } from "axios";

import { type Logger } from "../logging/logger";
import { type RequestConfigWithMeta } from "../logging/types";
import { parseOAuthError, requiresReAuthentication } from "../oauth/errors";
import { type OAuthSessionManager } from "../oauth/sessionManager";

import { type CoderApi } from "./coderApi";

const coderSessionTokenHeader = "Coder-Session-Token";

/**
 * Attach OAuth token refresh interceptors to a CoderApi instance.
 * This should be called after creating the CoderApi when OAuth authentication is being used.
 *
 * Success interceptor: proactively refreshes token when approaching expiry.
 * Error interceptor: reactively refreshes token on 401 responses.
 */
export function attachOAuthInterceptors(
	client: CoderApi,
	logger: Logger,
	oauthSessionManager: OAuthSessionManager,
): void {
	client.getAxiosInstance().interceptors.response.use(
		// Success response interceptor: proactive token refresh
		(response) => {
			if (oauthSessionManager.shouldRefreshToken()) {
				logger.debug(
					"Token approaching expiry, triggering proactive refresh in background",
				);

				// Fire-and-forget: don't await, don't block response
				oauthSessionManager.refreshToken().catch((error) => {
					logger.warn("Background token refresh failed:", error);
				});
			}

			return response;
		},
		// Error response interceptor: reactive token refresh on 401
		async (error: unknown) => {
			if (!isAxiosError(error)) {
				throw error;
			}

			if (error.config) {
				const config = error.config as {
					_oauthRetryAttempted?: boolean;
				};
				if (config._oauthRetryAttempted) {
					throw error;
				}
			}

			const status = error.response?.status;

			// These could indicate permanent auth failures that won't be fixed by token refresh
			if (status === 400 || status === 403) {
				handlePossibleOAuthError(error, logger, oauthSessionManager);
				throw error;
			} else if (status === 401) {
				return handle401Error(error, client, logger, oauthSessionManager);
			}

			throw error;
		},
	);
}

function handlePossibleOAuthError(
	error: unknown,
	logger: Logger,
	oauthSessionManager: OAuthSessionManager,
): void {
	const oauthError = parseOAuthError(error);
	if (oauthError && requiresReAuthentication(oauthError)) {
		logger.error(
			`OAuth error requires re-authentication: ${oauthError.errorCode}`,
		);

		oauthSessionManager.showReAuthenticationModal(oauthError).catch((err) => {
			logger.error("Failed to show re-auth modal:", err);
		});
	}
}

async function handle401Error(
	error: AxiosError,
	client: CoderApi,
	logger: Logger,
	oauthSessionManager: OAuthSessionManager,
): Promise<void> {
	if (!oauthSessionManager.isLoggedInWithOAuth()) {
		throw error;
	}

	logger.info("Received 401 response, attempting token refresh");

	try {
		const newTokens = await oauthSessionManager.refreshToken();
		client.setSessionToken(newTokens.access_token);

		logger.info("Token refresh successful, retrying request");

		// Retry the original request with the new token
		if (error.config) {
			const config = error.config as RequestConfigWithMeta & {
				_oauthRetryAttempted?: boolean;
			};
			config._oauthRetryAttempted = true;
			config.headers[coderSessionTokenHeader] = newTokens.access_token;
			return client.getAxiosInstance().request(config);
		}

		throw error;
	} catch (refreshError) {
		logger.error("Token refresh failed:", refreshError);

		handlePossibleOAuthError(refreshError, logger, oauthSessionManager);
		throw error;
	}
}
