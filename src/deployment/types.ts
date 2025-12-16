import { type User } from "coder/site/src/api/typesGenerated";

/**
 * Represents a Coder deployment with its URL and hostname.
 * The safeHostname is used as a unique identifier for storing credentials and configuration.
 * It is derived from the URL hostname (via toSafeHost) or from SSH host parsing.
 */
export interface Deployment {
	readonly url: string;
	readonly safeHostname: string;
}

/**
 * Deployment info with authentication credentials.
 * Used when logging in or changing to a new deployment.
 *
 * - Undefined token means that we should not override the existing token (if any).
 * - Undefined user means the deployment is set but not authenticated yet.
 */
export type DeploymentWithAuth = Deployment & {
	readonly token?: string;
	readonly user?: User;
};
