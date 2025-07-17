/**
 * Utility functions for masking sensitive data in logs
 */

/**
 * Masks sensitive information in log messages
 * @param message The message to mask
 * @returns The masked message
 */
export function maskSensitiveData(message: string): string {
	let masked = message;

	// Mask SSH private keys
	masked = masked.replace(
		/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g,
		"[REDACTED KEY]",
	);

	// Mask passwords in URLs
	masked = masked.replace(/:\/\/([^:]+):([^@]+)@/g, "://$1:[REDACTED]@");

	// Mask AWS access keys
	masked = masked.replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED AWS KEY]");

	// Mask bearer tokens
	masked = masked.replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]");

	// Mask common password patterns in config
	masked = masked.replace(
		/(password|passwd|pwd)\s*[:=]\s*["']?[^\s"']+["']?/gi,
		"$1: [REDACTED]",
	);

	// Mask token patterns
	masked = masked.replace(
		/(token|api_key|apikey)\s*[:=]\s*["']?[^\s"']+["']?/gi,
		"$1: [REDACTED]",
	);

	return masked;
}

/**
 * Truncates large data with a message
 * @param data The data to potentially truncate
 * @param maxLength Maximum length in characters (default 10KB)
 * @returns The potentially truncated data
 */
export function truncateLargeData(data: string, maxLength = 10240): string {
	if (data.length <= maxLength) {
		return data;
	}
	return data.substring(0, maxLength) + "\n[TRUNCATED after 10KB]";
}
