export interface TelemetryJsonlFileName {
	date: string;
	session: string;
	part: number;
}

/**
 * Filename shape written by the local JSONL sink:
 * `telemetry-YYYY-MM-DD-{session}[.{part}].jsonl`.
 */
const TELEMETRY_JSONL_FILE_PATTERN =
	/^telemetry-(\d{4}-\d{2}-\d{2})-([^.]+)(?:\.(\d+))?\.jsonl$/;

export function formatTelemetryJsonlFileName(
	date: string,
	session: string,
	part = 0,
): string {
	const partSuffix = part > 0 ? `.${part}` : "";
	return `telemetry-${date}-${session}${partSuffix}.jsonl`;
}

export function isTelemetryJsonlFileName(name: string): boolean {
	return parseTelemetryJsonlFileName(name) !== undefined;
}

export function parseTelemetryJsonlFileName(
	name: string,
): TelemetryJsonlFileName | undefined {
	const match = TELEMETRY_JSONL_FILE_PATTERN.exec(name);
	if (!match) {
		return undefined;
	}
	return {
		date: match[1],
		session: match[2],
		part: match[3] === undefined ? 0 : Number(match[3]),
	};
}
