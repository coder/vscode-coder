import { beforeEach, describe, expect, it } from "vitest";

import {
	LOCAL_JSONL_DEFAULTS,
	LOCAL_JSONL_SETTING,
	TELEMETRY_LEVEL_SETTING,
	readLocalJsonlConfig,
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

	describe("readLocalJsonlConfig", () => {
		it("returns defaults when unset", () => {
			expect(readLocalJsonlConfig(config)).toEqual(LOCAL_JSONL_DEFAULTS);
		});

		it.each([
			["a string", "nope"],
			["a boolean", true],
			["null", null],
			["an array", [1, 2]],
		])("returns defaults when the raw value is %s", (_, raw) => {
			config.set(LOCAL_JSONL_SETTING, raw);
			expect(readLocalJsonlConfig(config)).toEqual(LOCAL_JSONL_DEFAULTS);
		});

		it("accepts a fully-specified object", () => {
			const custom = {
				flushIntervalMs: 1_000,
				flushBatchSize: 10,
				bufferLimit: 50,
				maxFileBytes: 1024,
				maxAgeDays: 7,
				maxTotalBytes: 4096,
			};
			config.set(LOCAL_JSONL_SETTING, custom);
			expect(readLocalJsonlConfig(config)).toEqual(custom);
		});

		it.each([
			["zero", 0],
			["a negative", -1],
			["NaN", Number.NaN],
			["a numeric string", "100"],
			["a boolean", true],
		])("falls back per-field when a value is %s", (_, bad) => {
			config.set(LOCAL_JSONL_SETTING, { flushIntervalMs: bad });
			expect(readLocalJsonlConfig(config).flushIntervalMs).toBe(
				LOCAL_JSONL_DEFAULTS.flushIntervalMs,
			);
		});

		it("merges valid fields with defaults for invalid ones", () => {
			config.set(LOCAL_JSONL_SETTING, {
				flushIntervalMs: 5_000,
				flushBatchSize: -1,
			});
			expect(readLocalJsonlConfig(config)).toEqual({
				...LOCAL_JSONL_DEFAULTS,
				flushIntervalMs: 5_000,
			});
		});

		it("returns bufferLimit and flushBatchSize as written, without clamping", () => {
			config.set(LOCAL_JSONL_SETTING, {
				flushBatchSize: 200,
				bufferLimit: 50,
			});
			expect(readLocalJsonlConfig(config)).toMatchObject({
				flushBatchSize: 200,
				bufferLimit: 50,
			});
		});
	});
});
