import type { StoredOAuthTokens } from "../core/secretsManager";
import type { Logger } from "../logging/logger";

// Token refresh timing constant
const TOKEN_REFRESH_THRESHOLD_MS = 20 * 60 * 1000;

/**
 * Manages automatic token refresh scheduling.
 * Calculates optimal refresh timing and triggers refresh callbacks.
 */
export class OAuthTokenRefreshScheduler {
	private refreshTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly refreshCallback: () => Promise<void>,
		private readonly logger: Logger,
	) {}

	/**
	 * Schedule automatic token refresh based on token expiry.
	 */
	schedule(tokens: StoredOAuthTokens): void {
		this.stop();

		if (!tokens.refresh_token) {
			this.logger.debug("No refresh token available, skipping timer setup");
			return;
		}

		const now = Date.now();
		const timeUntilRefresh =
			tokens.expiry_timestamp - TOKEN_REFRESH_THRESHOLD_MS - now;

		if (timeUntilRefresh <= 0) {
			this.logger.info("Token needs immediate refresh");
			this.refreshCallback().catch((error) => {
				this.logger.error("Immediate token refresh failed:", error);
			});
			return;
		}

		this.refreshTimer = setTimeout(() => {
			this.logger.debug("Token refresh timer fired, refreshing token...");
			this.refreshCallback().catch((error) => {
				this.logger.error("Scheduled token refresh failed:", error);
			});
		}, timeUntilRefresh);

		this.logger.debug("Token refresh timer scheduled", {
			fires_at: new Date(now + timeUntilRefresh).toISOString(),
			fires_in_seconds: Math.round(timeUntilRefresh / 1000),
		});
	}

	/**
	 * Stop the background token refresh timer.
	 */
	stop(): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
			this.logger.debug("Token refresh timer stopped");
		}
	}
}
