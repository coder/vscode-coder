/**
 * Represents a Coder deployment with its URL and label.
 * The label is used as a unique identifier for storing credentials and configuration.
 * It may be derived from the URL hostname (via toSafeHost) or come from SSH host parsing.
 */
export interface Deployment {
	readonly url: string;
	readonly label: string;
}
