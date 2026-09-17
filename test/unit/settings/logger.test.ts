import { describe, expect, it } from "vitest";

import { HttpClientLogLevel } from "@/logging/types";
import {
	DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
	MAX_CONNECTION_LOG_BUFFER_SIZE,
	readConnectionLogBufferSize,
	readHttpClientLogLevel,
} from "@/settings/logger";

import type { WorkspaceConfiguration } from "vscode";

function cfg(value: unknown): Pick<WorkspaceConfiguration, "get"> {
	return {
		get: (_key: string, fallback?: unknown) =>
			value === undefined ? fallback : value,
	} as Pick<WorkspaceConfiguration, "get">;
}

describe("readConnectionLogBufferSize", () => {
	interface Case {
		name: string;
		value: unknown;
		expected: number;
	}

	it.each<Case>([
		{
			name: "returns the configured value when in range",
			value: 250,
			expected: 250,
		},
		{ name: "floors fractional values", value: 250.9, expected: 250 },
		{ name: "treats zero as disabled", value: 0, expected: 0 },
		{
			name: "clamps values above the maximum",
			value: 1_000_000,
			expected: MAX_CONNECTION_LOG_BUFFER_SIZE,
		},
		{
			name: "falls back to the default for a negative value",
			value: -1,
			expected: DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
		},
		{
			name: "falls back to the default for Infinity",
			value: Infinity,
			expected: DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
		},
		{
			name: "falls back to the default for NaN",
			value: Number.NaN,
			expected: DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
		},
		{
			name: "falls back to the default for a numeric string",
			value: "2000",
			expected: DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
		},
		{
			name: "falls back to the default for null",
			value: null,
			expected: DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
		},
		{
			name: "falls back to the default for an object",
			value: {},
			expected: DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
		},
		{
			name: "uses the default when unset",
			value: undefined,
			expected: DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
		},
	])("$name", ({ value, expected }) => {
		expect(readConnectionLogBufferSize(cfg(value))).toBe(expected);
	});
});

describe("readHttpClientLogLevel", () => {
	it("maps a known level case-insensitively", () => {
		expect(readHttpClientLogLevel(cfg("body"))).toBe(HttpClientLogLevel.BODY);
	});

	it("falls back to BASIC for an unknown level", () => {
		expect(readHttpClientLogLevel(cfg("nonsense"))).toBe(
			HttpClientLogLevel.BASIC,
		);
	});

	it.each([2, null])(
		"falls back to BASIC for a non-string value %p",
		(value) => {
			expect(readHttpClientLogLevel(cfg(value))).toBe(HttpClientLogLevel.BASIC);
		},
	);
});
