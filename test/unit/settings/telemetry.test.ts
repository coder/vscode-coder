import { beforeEach, describe, expect, it } from "vitest";

import {
	HTTP_REQUESTS_TELEMETRY_DEFAULTS,
	LOCAL_SINK_DEFAULTS,
	LOCAL_TELEMETRY_SETTING,
	TELEMETRY_LEVEL_SETTING,
	readHttpRequestsTelemetryConfig,
	readLocalSinkConfig,
	readTelemetryLevel,
} from "@/settings/telemetry";

import { MockConfigurationProvider } from "../../mocks/testHelpers";

describe("telemetry settings", () => {
	let config: MockConfigurationProvider;

	beforeEach(() => {
		config = new MockConfigurationProvider();
	});

	describe("readTelemetryLevel", () => {
		it.each([
			["off", "off"],
			["local", "local"],
			[undefined, "local"],
			["bogus", "local"],
			[42, "local"],
			[null, "local"],
		])("when value is %p, returns %p", (value, expected) => {
			if (value !== undefined) {
				config.set(TELEMETRY_LEVEL_SETTING, value);
			}
			expect(readTelemetryLevel(config)).toBe(expected);
		});
	});

	describe("readLocalSinkConfig", () => {
		it("returns defaults when unset", () => {
			expect(readLocalSinkConfig(config)).toEqual(LOCAL_SINK_DEFAULTS);
		});

		it.each([
			["a string", "nope"],
			["a boolean", true],
			["null", null],
			["an array", [1, 2]],
		])("returns defaults when the raw value is %s", (_, raw) => {
			config.set(LOCAL_TELEMETRY_SETTING, raw);
			expect(readLocalSinkConfig(config)).toEqual(LOCAL_SINK_DEFAULTS);
		});

		it("accepts a fully-specified object", () => {
			const custom = {
				flushIntervalMs: 1_000,
				flushBatchSize: 10,
				bufferLimit: 50,
				maxFileBytes: 8192,
				maxAgeDays: 7,
				maxTotalBytes: 8192,
			};
			config.set(LOCAL_TELEMETRY_SETTING, custom);
			expect(readLocalSinkConfig(config)).toEqual(custom);
		});

		it.each([
			["zero", 0],
			["a negative", -1],
			["NaN", Number.NaN],
			["a numeric string", "100"],
			["a boolean", true],
		])("falls back per-field when a value is %s", (_, bad) => {
			config.set(LOCAL_TELEMETRY_SETTING, { flushIntervalMs: bad });
			expect(readLocalSinkConfig(config).flushIntervalMs).toBe(
				LOCAL_SINK_DEFAULTS.flushIntervalMs,
			);
		});

		it("merges valid fields with defaults for invalid ones", () => {
			config.set(LOCAL_TELEMETRY_SETTING, {
				flushIntervalMs: 5_000,
				flushBatchSize: -1,
			});
			expect(readLocalSinkConfig(config)).toEqual({
				...LOCAL_SINK_DEFAULTS,
				flushIntervalMs: 5_000,
			});
		});

		it("returns bufferLimit and flushBatchSize as written, without clamping", () => {
			config.set(LOCAL_TELEMETRY_SETTING, {
				flushBatchSize: 200,
				bufferLimit: 50,
			});
			expect(readLocalSinkConfig(config)).toMatchObject({
				flushBatchSize: 200,
				bufferLimit: 50,
			});
		});
	});

	describe("readHttpRequestsTelemetryConfig", () => {
		it("returns defaults when unset", () => {
			expect(readHttpRequestsTelemetryConfig(config)).toEqual(
				HTTP_REQUESTS_TELEMETRY_DEFAULTS,
			);
		});

		it.each([
			["a string", "nope"],
			["a boolean", true],
			["null", null],
			["an array", [1, 2]],
		])("returns defaults when the raw value is %s", (_, raw) => {
			config.set(LOCAL_TELEMETRY_SETTING, raw);
			expect(readHttpRequestsTelemetryConfig(config)).toEqual(
				HTTP_REQUESTS_TELEMETRY_DEFAULTS,
			);
		});

		it("accepts a fully-specified object", () => {
			config.set(LOCAL_TELEMETRY_SETTING, {
				httpRequests: { windowSeconds: 10 },
			});
			expect(readHttpRequestsTelemetryConfig(config)).toEqual({
				windowSeconds: 10,
			});
		});

		it.each([
			["zero", 0],
			["a negative", -1],
			["NaN", Number.NaN],
			["a numeric string", "100"],
			["a boolean", true],
		])("falls back per-field when a value is %s", (_, bad) => {
			config.set(LOCAL_TELEMETRY_SETTING, {
				httpRequests: { windowSeconds: bad },
			});
			expect(readHttpRequestsTelemetryConfig(config).windowSeconds).toBe(
				HTTP_REQUESTS_TELEMETRY_DEFAULTS.windowSeconds,
			);
		});

		it("ignores invalid httpRequests values", () => {
			config.set(LOCAL_TELEMETRY_SETTING, { httpRequests: "nope" });
			expect(readHttpRequestsTelemetryConfig(config)).toEqual(
				HTTP_REQUESTS_TELEMETRY_DEFAULTS,
			);
		});
	});
});
