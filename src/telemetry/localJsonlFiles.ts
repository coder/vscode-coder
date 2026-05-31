export interface ParsedFileName {
	date: string;
	session: string;
	part: number;
}

/**
 * Filename shape written by the local JSONL sink:
 * `telemetry-YYYY-MM-DD-{session}[.{part}].jsonl`.
 */
const FILE_NAME_PATTERN =
	/^telemetry-(\d{4}-\d{2}-\d{2})-([^.]+)(?:\.(\d+))?\.jsonl$/;

export function formatFileName(
	date: string,
	session: string,
	part = 0,
): string {
	const partSuffix = part > 0 ? `.${part}` : "";
	return `telemetry-${date}-${session}${partSuffix}.jsonl`;
}

export function isFileName(name: string): boolean {
	return parseFileName(name) !== undefined;
}

export function parseFileName(name: string): ParsedFileName | undefined {
	const match = FILE_NAME_PATTERN.exec(name);
	if (!match) {
		return undefined;
	}
	return {
		date: match[1],
		session: match[2],
		part: match[3] === undefined ? 0 : Number(match[3]),
	};
}
