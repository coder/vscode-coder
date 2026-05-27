import "axios";

declare module "axios" {
	interface InternalAxiosRequestConfig {
		/** Set once the OAuth-refresh or interactive re-auth path has run. */
		_retryAttempted?: boolean;
		/**
		 * Set once the silent auth-config-change retry has run. Separate
		 * from `_retryAttempted` so a follow-up 401 can still escalate to
		 * OAuth or interactive re-auth.
		 */
		_authConfigRetryAttempted?: boolean;
		/** Set once a client-certificate error has been retried with refreshed certs. */
		_certRetried?: boolean;
		/**
		 * Auth-config version snapshotted when the request was stamped.
		 * Compared on a 401 to detect that auth settings changed mid-flight.
		 */
		authConfigVersion?: number;
		/**
		 * Headers the previous header-command run added to this request.
		 * Cleared at the start of the next pass so stale keys don't leak
		 * through when the command output changes between retries.
		 */
		headerCommandKeys?: string[];
	}
}
