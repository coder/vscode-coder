import { afterEach, describe, expect, it, vi } from "vitest";

import {
	HttpRequestsTelemetry,
	normalizeHttpRoute,
} from "@/logging/httpRequestsTelemetry";
import { LOCAL_SINK_SETTING } from "@/settings/telemetry";
import {
	NOOP_TELEMETRY_REPORTER,
	type TelemetryReporter,
} from "@/telemetry/reporter";

import { MockConfigurationProvider } from "../../mocks/testHelpers";

interface Harness {
	rollup: HttpRequestsTelemetry;
	log: ReturnType<typeof vi.fn>;
}

function makeHarness(windowSeconds = 60): Harness {
	vi.useFakeTimers();
	const config = new MockConfigurationProvider();
	config.set("coder.telemetry.level", "local");
	config.set(LOCAL_SINK_SETTING, {
		httpRequests: { windowSeconds },
	});

	const log = vi.fn();
	const reporter: TelemetryReporter = {
		...NOOP_TELEMETRY_REPORTER,
		log,
	};
	return {
		rollup: HttpRequestsTelemetry.start(reporter),
		log,
	};
}

describe("HttpRequestsTelemetry", () => {
	let h: Harness | undefined;

	afterEach(() => {
		h?.rollup.dispose();
		h = undefined;
		vi.useRealTimers();
	});

	it("rolls several requests for the same method and route into one event", async () => {
		h = makeHarness(2);

		h.rollup.record({
			method: "get",
			url: "/api/v2/workspaces/abc-123?owner=danny",
			statusCode: 200,
			durationMs: 100,
		});
		h.rollup.record({
			method: "GET",
			url: "/api/v2/workspaces/abc-123?owner=someone-else",
			statusCode: 204,
			durationMs: 200,
		});
		h.rollup.record({
			method: "GET",
			url: "/api/v2/workspaces/abc-123",
			statusCode: 200,
			durationMs: 300,
		});

		await vi.advanceTimersByTimeAsync(2000);

		expect(h.log).toHaveBeenCalledTimes(1);
		expect(h.log).toHaveBeenCalledWith(
			"http.requests",
			{ method: "GET", route: "/api/v2/workspaces/{id}" },
			{
				window_seconds: 2,
				count_2xx: 3,
				count_3xx: 0,
				count_4xx: 0,
				count_5xx: 0,
				count_network_error: 0,
				avg_duration_ms: 200,
				p95_duration_ms: 300,
			},
		);
	});

	it("counts status code classes and network errors in the right buckets", async () => {
		h = makeHarness(1);
		const baseSample = {
			method: "POST",
			url: "/api/v2/users/danny/workspaces",
		};

		h.rollup.record({ ...baseSample, statusCode: 201, durationMs: 10 });
		h.rollup.record({ ...baseSample, statusCode: 302, durationMs: 20 });
		h.rollup.record({ ...baseSample, statusCode: 404, durationMs: 30 });
		h.rollup.record({ ...baseSample, statusCode: 500, durationMs: 40 });
		h.rollup.record({ ...baseSample, networkError: true, durationMs: 50 });

		await vi.advanceTimersByTimeAsync(1000);

		expect(h.log).toHaveBeenCalledWith(
			"http.requests",
			{ method: "POST", route: "/api/v2/users/{name}/workspaces" },
			expect.objectContaining({
				count_2xx: 1,
				count_3xx: 1,
				count_4xx: 1,
				count_5xx: 1,
				count_network_error: 1,
			}),
		);
	});

	it("does not emit for an empty window", async () => {
		h = makeHarness(1);

		await vi.advanceTimersByTimeAsync(1000);

		expect(h.log).not.toHaveBeenCalled();
	});

	it("calculates p95 with the sorted nearest-rank reference", async () => {
		h = makeHarness(1);
		const durations = [
			10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
			170, 180, 190, 200,
		];

		for (const durationMs of durations) {
			h.rollup.record({
				method: "GET",
				url: "/api/v2/workspaces/ws-id",
				statusCode: 200,
				durationMs,
			});
		}

		await vi.advanceTimersByTimeAsync(1000);

		expect(h.log).toHaveBeenCalledWith(
			"http.requests",
			{ method: "GET", route: "/api/v2/workspaces/{id}" },
			expect.objectContaining({
				avg_duration_ms: 105,
				p95_duration_ms: 190,
			}),
		);
	});

	it("normalizes routes without preserving query strings or identifiers", () => {
		expect(normalizeHttpRoute("/api/v2/workspaces/abc-123?foo=bar")).toBe(
			"/api/v2/workspaces/{id}",
		);
		expect(normalizeHttpRoute("/api/v2/users/danny/workspaces")).toBe(
			"/api/v2/users/{name}/workspaces",
		);
		expect(
			normalizeHttpRoute(
				"/api/v2/workspaceagents/9f0f7f37-dfb7-4f4b-bcb8-c7062c7550fc/logs",
			),
		).toBe("/api/v2/workspaceagents/{id}/logs");
		expect(normalizeHttpRoute("/api/v2/workspaces/123/builds/456")).toBe(
			"/api/v2/workspaces/{id}/builds/{id}",
		);
	});
});
