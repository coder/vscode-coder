import { describe, expect, it } from "vitest";

import {
	formatTelemetryJsonlFileName,
	isTelemetryJsonlFileName,
	parseTelemetryJsonlFileName,
} from "@/telemetry/localJsonlFiles";

describe("local JSONL telemetry filenames", () => {
	it.each([
		{
			name: "telemetry-2026-05-12-aaaaaaaa.jsonl",
			expected: { date: "2026-05-12", session: "aaaaaaaa", part: 0 },
		},
		{
			name: "telemetry-2026-05-12-aaaaaaaa.12.jsonl",
			expected: { date: "2026-05-12", session: "aaaaaaaa", part: 12 },
		},
	])("parses $name", ({ name, expected }) => {
		expect(parseTelemetryJsonlFileName(name)).toEqual(expected);
		expect(isTelemetryJsonlFileName(name)).toBe(true);
	});

	it.each([
		"notes.jsonl",
		"telemetry-2026-05-12-aaaaaaaa.json",
		"telemetry-2026-05-12-aaaaaaaa.bad.jsonl",
		"telemetry-2026-05-12.jsonl",
	])("rejects %s", (name) => {
		expect(parseTelemetryJsonlFileName(name)).toBeUndefined();
		expect(isTelemetryJsonlFileName(name)).toBe(false);
	});

	it.each([
		[
			"2026-05-12",
			"aaaaaaaa",
			undefined,
			"telemetry-2026-05-12-aaaaaaaa.jsonl",
		],
		["2026-05-12", "aaaaaaaa", 0, "telemetry-2026-05-12-aaaaaaaa.jsonl"],
		["2026-05-12", "aaaaaaaa", 2, "telemetry-2026-05-12-aaaaaaaa.2.jsonl"],
	] as const)("formats part %s %s %s", (date, session, part, expected) => {
		expect(formatTelemetryJsonlFileName(date, session, part)).toBe(expected);
	});
});
