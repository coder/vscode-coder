import * as vscode from "vscode";

import { CertificateError } from "./certificateError";

/**
 * Error thrown when a TLS client certificate has expired.
 * Provides user-friendly messages depending on whether a refresh command is configured.
 */
export class ClientCertificateError extends CertificateError {
	public static readonly ActionConfigure = "Configure Refresh Command";
	public readonly detail: string;

	/**
	 * Checks if an error indicates client certificate expiration.
	 * Matches SSL error patterns from BoringSSL/OpenSSL:
	 * - SSLV3_ALERT_CERTIFICATE_EXPIRED
	 * - certificate_expired
	 * - SSL alert number 45
	 */
	public static isExpiredError(err: unknown): boolean {
		const message =
			(err as { message?: string })?.message ??
			(err as { error?: { message?: string } })?.error?.message ??
			String(err);
		return (
			message.includes("SSLV3_ALERT_CERTIFICATE_EXPIRED") ||
			message.includes("certificate_expired") ||
			message.includes("SSL alert number 45")
		);
	}

	public constructor(
		public override readonly cause: Error,
		public readonly noRefreshCommand: boolean,
	) {
		const detail = noRefreshCommand
			? "Your TLS client certificate has expired. Configure a refresh command in settings to automatically renew certificates, or manually refresh your credentials."
			: "Your TLS client certificate has expired and automatic refresh failed. Check your refresh command configuration or manually refresh your credentials.";
		super(detail);
		this.detail = detail;
		this.name = "ClientCertificateError";
	}

	async showNotification(
		title?: string,
		options?: { modal?: boolean },
	): Promise<void> {
		const modal = options?.modal ?? false;
		const val = await vscode.window.showErrorMessage(
			title || this.detail,
			{ modal, useCustom: modal, detail: this.detail },
			ClientCertificateError.ActionConfigure,
		);
		if (val === ClientCertificateError.ActionConfigure) {
			await vscode.commands.executeCommand(
				"workbench.action.openSettings",
				"coder.tlsCertRefreshCommand",
			);
		}
	}
}
