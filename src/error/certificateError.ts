/**
 * Base class for certificate-related errors that can display notifications to users.
 * Use `instanceof CertificateError` to check if an error is a certificate error.
 */
export abstract class CertificateError extends Error {
	/** Human-friendly detail message for display */
	public abstract readonly detail: string;

	/** Show error notification. Pass { modal: true } for modal dialogs. */
	public abstract showNotification(
		title?: string,
		options?: { modal?: boolean },
	): Promise<void>;
}
