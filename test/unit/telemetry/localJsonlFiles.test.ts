import { describe, expect, it } from "vitest";

import * as localJsonlFiles from "@/telemetry/localJsonlFiles";

const parsedFileNameCases = [
	[
		"telemetry-2026-05-12-aaaaaaaa.jsonl",
		{ date: "2026-05-12", session: "aaaaaaaa", part: 0 },
	],
	[
		"telemetry-2026-05-12-aaaaaaaa.12.jsonl",
		{ date: "2026-05-12", session: "aaaaaaaa", part: 12 },
	],
] as const;

const invalidFileNames = [
	"notes.jsonl",
	"telemetry-2026-05-12-aaaaaaaa.json",
	"telemetry-2026-05-12-aaaaaaaa.bad.jsonl",
	"telemetry-2026-05-12.jsonl",
] as const;

describe("localJsonlFiles", () => {
	it.each(parsedFileNameCases)("parses %s", (name, expected) => {
		expect(localJsonlFiles.parseFileName(name)).toEqual(expected);
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
	] as const)("formats %s %s part %s", (date, session, part, expected) => {
		expect(localJsonlFiles.formatFileName(date, session, part)).toBe(expected);
	});

	it.each(parsedFileNameCases.map(([name]) => [name] as const))(
		"matches %s",
		(name) => {
			expect(localJsonlFiles.isFileName(name)).toBe(true);
		},
	);

	it.each(invalidFileNames)("rejects %s", (name) => {
		expect(localJsonlFiles.parseFileName(name)).toBeUndefined();
		expect(localJsonlFiles.isFileName(name)).toBe(false);
	});
});
