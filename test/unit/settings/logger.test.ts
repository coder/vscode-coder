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
	it("returns the configured value when in range", () => {
		expect(readConnectionLogBufferSize(cfg(250))).toBe(250);
	});

	it("floors fractional values", () => {
		expect(readConnectionLogBufferSize(cfg(250.9))).toBe(250);
	});

	it("treats zero as disabled", () => {
		expect(readConnectionLogBufferSize(cfg(0))).toBe(0);
	});

	it("clamps values above the maximum", () => {
		expect(readConnectionLogBufferSize(cfg(1_000_000))).toBe(
			MAX_CONNECTION_LOG_BUFFER_SIZE,
		);
	});

	it.each([-1, Infinity, Number.NaN, "2000", null, {}])(
		"falls back to the default for invalid value %p",
		(value) => {
			expect(readConnectionLogBufferSize(cfg(value))).toBe(
				DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
			);
		},
	);

	it("uses the default when unset", () => {
		expect(readConnectionLogBufferSize(cfg(undefined))).toBe(
			DEFAULT_CONNECTION_LOG_BUFFER_SIZE,
		);
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
});
