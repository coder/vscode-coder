import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { parseSpeedtestResult } from "@/webviews/speedtest/types";

import validResult from "./fixtures/speedtest-result.json";

describe("parseSpeedtestResult", () => {
	it("returns parsed data for a valid payload", () => {
		const result = parseSpeedtestResult(JSON.stringify(validResult));
		expect(result.overall.throughput_mbits).toBe(100);
		expect(result.intervals).toHaveLength(2);
	});

	it("throws ZodError when a required field is missing", () => {
		const missingOverall = JSON.stringify({ intervals: [] });
		expect(() => parseSpeedtestResult(missingOverall)).toThrow(ZodError);
	});

	it("throws ZodError when a field has the wrong type", () => {
		const wrongType = JSON.stringify({
			overall: {
				start_time_seconds: "0",
				end_time_seconds: 5,
				throughput_mbits: 100,
			},
			intervals: [],
		});
		expect(() => parseSpeedtestResult(wrongType)).toThrow(ZodError);
	});

	it("throws SyntaxError on malformed JSON", () => {
		expect(() => parseSpeedtestResult("not json")).toThrow(SyntaxError);
	});
});
