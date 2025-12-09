import { type User } from "coder/site/src/api/typesGenerated";

/**
 * Represents a Coder deployment with its URL and label.
 * The label is used as a unique identifier for storing credentials and configuration.
 * It may be derived from the URL hostname (via toSafeHost) or come from SSH host parsing.
 */
export interface Deployment {
	readonly url: string;
	readonly label: string;
}

/**
 * Deployment info with authentication credentials.
 * Used when logging in or changing to a new deployment.
 *
 * - Undefined token means that we should not override the existing token (if any).
 * - Undefined user means the deployment is set but not authenticated yet.
 */
export type DeploymentWithAuth = Deployment & { token?: string; user?: User };

/**
 * Type guard to check if a deployment has a valid authenticated user.
 */
export function isAuthenticated(
	deployment: DeploymentWithAuth | null,
): deployment is Deployment & { user: User } {
	return deployment?.user !== undefined;
}
