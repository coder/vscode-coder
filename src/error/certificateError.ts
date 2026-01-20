import { vscodeProposed } from "../vscodeProposed";

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

	protected async showErrorMessage<T extends string>(
		title?: string,
		options?: { modal?: boolean },
		...items: T[]
	): Promise<T | undefined> {
		const modal = options?.modal ?? false;
		const message =
			!modal && title ? `${title}: ${this.detail}` : title || this.detail;

		return await vscodeProposed.window.showErrorMessage(
			message,
			{ modal, useCustom: modal, detail: this.detail },
			...(items ?? []),
		);
	}
}
