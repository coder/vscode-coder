import * as vscode from "vscode";

import { CertificateError } from "./certificateError";
import { toError } from "./errorUtils";

/**
 * SSL/TLS alert codes related to client certificates (RFC 5246).
 */
export enum CLIENT_CERT_ALERT {
	BAD_CERTIFICATE = 42,
	UNSUPPORTED_CERTIFICATE = 43,
	CERTIFICATE_REVOKED = 44,
	CERTIFICATE_EXPIRED = 45,
	CERTIFICATE_UNKNOWN = 46,
	UNKNOWN_CA = 48,
	ACCESS_DENIED = 49,
}

/**
 * User-friendly messages for each client certificate alert code.
 */
export const CLIENT_CERT_MESSAGES: Record<CLIENT_CERT_ALERT, string> = {
	[CLIENT_CERT_ALERT.BAD_CERTIFICATE]:
		"Your TLS client certificate appears to be corrupted or has invalid signatures.",
	[CLIENT_CERT_ALERT.UNSUPPORTED_CERTIFICATE]:
		"Your TLS client certificate type is not supported by the server.",
	[CLIENT_CERT_ALERT.CERTIFICATE_REVOKED]:
		"Your TLS client certificate has been revoked.",
	[CLIENT_CERT_ALERT.CERTIFICATE_EXPIRED]:
		"Your TLS client certificate has expired.",
	[CLIENT_CERT_ALERT.CERTIFICATE_UNKNOWN]:
		"Your TLS client certificate was rejected for an unspecified reason.",
	[CLIENT_CERT_ALERT.UNKNOWN_CA]:
		"Your TLS client certificate was issued by an untrusted Certificate Authority.",
	[CLIENT_CERT_ALERT.ACCESS_DENIED]:
		"Access was denied using your TLS client certificate.",
};

/**
 * Type guard to filter out reverse mappings from TypeScript numeric enums.
 */
function isNumericEnumEntry(
	entry: [string, string | CLIENT_CERT_ALERT],
): entry is [string, CLIENT_CERT_ALERT] {
	return typeof entry[1] === "number";
}

/**
 * Patterns to match SSL alert types in error messages (case-insensitive).
 */
const ALERT_PATTERNS: ReadonlyArray<[string, CLIENT_CERT_ALERT]> =
	Object.entries(CLIENT_CERT_ALERT)
		.filter(isNumericEnumEntry)
		.map(([name, code]) => [name.toLowerCase(), code]);

/**
 * Alert codes that may be recoverable by refreshing the certificate.
 *
 * Refreshable alerts are those where obtaining/reloading a new certificate
 * could resolve the issue:
 * - CERTIFICATE_EXPIRED: Certificate validity period has passed
 * - CERTIFICATE_REVOKED: Certificate was revoked but a new one may be valid
 * - BAD_CERTIFICATE: Certificate may be corrupted; reloading may help
 * - CERTIFICATE_UNKNOWN: Ambiguous rejection; refresh worth attempting
 *
 * Non-refreshable alerts require administrator intervention:
 * - UNSUPPORTED_CERTIFICATE: Server doesn't support the certificate type
 * - UNKNOWN_CA: CA not in server's trust store (config issue)
 * - ACCESS_DENIED: Authorization denied (policy issue)
 */
const REFRESHABLE_ALERTS: ReadonlySet<CLIENT_CERT_ALERT> = new Set([
	CLIENT_CERT_ALERT.CERTIFICATE_EXPIRED,
	CLIENT_CERT_ALERT.CERTIFICATE_REVOKED,
	CLIENT_CERT_ALERT.BAD_CERTIFICATE,
	CLIENT_CERT_ALERT.CERTIFICATE_UNKNOWN,
]);

/**
 * Error thrown when a TLS client certificate issue is detected.
 * Provides user-friendly messages depending on the specific error type
 * and whether a refresh command is configured.
 */
export class ClientCertificateError extends CertificateError {
	private static readonly ActionConfigure = "Configure Refresh Command";

	/**
	 * Extract error message string from various error types.
	 * Handles Error objects and plain strings.
	 */
	private static extractErrorMessage(err: unknown): string {
		if (!err) {
			return "";
		}
		if (typeof err === "string") {
			return err;
		}

		const obj = err as { message?: string; code?: string };
		return [obj.code, obj.message].filter(Boolean).join(" ");
	}

	/**
	 * Create a ClientCertificateError from any error type if it contains
	 * a recognized client certificate alert code.
	 * Returns undefined if the error is not a recognized client certificate error.
	 */
	public static fromError(err: unknown): ClientCertificateError | undefined {
		const alertCode = this.detectAlertCode(err);
		if (alertCode === undefined) {
			return undefined;
		}

		const baseMessage = CLIENT_CERT_MESSAGES[alertCode];
		const isRefreshable = REFRESHABLE_ALERTS.has(alertCode);

		const detail = isRefreshable
			? `${baseMessage} Try refreshing your credentials manually, or configure automatic certificate refresh in settings.`
			: `${baseMessage} This issue cannot be resolved by refreshing the certificate. Please contact your administrator.`;

		return new ClientCertificateError(
			toError(err),
			alertCode,
			detail,
			isRefreshable,
		);
	}

	/**
	 * Detect the SSL alert code from any error type.
	 * Returns undefined if the error is not a recognized client certificate error.
	 */
	private static detectAlertCode(err: unknown): CLIENT_CERT_ALERT | undefined {
		const message = this.extractErrorMessage(err).toLowerCase();
		if (!message) {
			return undefined;
		}

		// Check for alert patterns (case-insensitive via lowercase)
		for (const [pattern, alertCode] of ALERT_PATTERNS) {
			if (message.includes(pattern)) {
				return alertCode;
			}
		}

		// Fall back to parsing "ssl alert number XX"
		const alertMatch = /ssl alert number (\d+)/.exec(message);
		if (alertMatch) {
			const alertNumber = Number.parseInt(alertMatch[1], 10);
			if (alertNumber in CLIENT_CERT_ALERT) {
				return alertNumber;
			}
		}

		return undefined;
	}

	/**
	 * Check if an error is a refreshable client certificate error.
	 */
	public static isRefreshable(err: unknown): boolean {
		const alertCode = this.detectAlertCode(err);
		return alertCode !== undefined && REFRESHABLE_ALERTS.has(alertCode);
	}

	private constructor(
		public override readonly cause: Error,
		public readonly alertCode: CLIENT_CERT_ALERT,
		public readonly detail: string,
		public readonly isRefreshable: boolean,
	) {
		super(detail);
		this.name = "ClientCertificateError";
	}

	async showNotification(
		title?: string,
		options?: { modal?: boolean },
	): Promise<void> {
		// Only show the configure action for refreshable errors
		const actions = this.isRefreshable
			? [ClientCertificateError.ActionConfigure]
			: [];

		const val = await this.showErrorMessage(title, options, ...actions);

		if (val === ClientCertificateError.ActionConfigure) {
			await vscode.commands.executeCommand(
				"workbench.action.openSettings",
				"coder.tlsCertRefreshCommand",
			);
		}
	}
}
