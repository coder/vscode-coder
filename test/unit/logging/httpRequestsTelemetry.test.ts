import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	HttpRequestsTelemetry,
	normalizeHttpRoute,
} from "@/logging/httpRequestsTelemetry";
import {
	NOOP_TELEMETRY_REPORTER,
	type TelemetryReporter,
} from "@/telemetry/reporter";

import type { RequestConfigWithMeta } from "@/logging/types";

interface Harness {
	rollup: HttpRequestsTelemetry;
	log: ReturnType<typeof vi.fn>;
}

interface RequestOptions {
	readonly method?: string;
	readonly url: string;
	readonly status?: number;
	readonly durationMs?: number;
}

describe("HttpRequestsTelemetry", () => {
	afterEach(() => vi.useRealTimers());

	it("emits one event per active method and route at the window boundary", async () => {
		const { rollup, log } = createHarness(2);
		try {
			recordResponse(rollup, {
				method: "get",
				url: "/api/v2/workspaces/abc-123?owner=danny",
				status: 200,
				durationMs: 100,
			});
			recordResponse(rollup, {
				method: "GET",
				url: "/api/v2/workspaces/abc-123?owner=someone-else",
				status: 204,
				durationMs: 200,
			});
			recordResponse(rollup, {
				method: "POST",
				url: "/api/v2/workspaces/abc-123",
				status: 201,
				durationMs: 300,
			});

			await vi.advanceTimersByTimeAsync(2000);

			expect(log).toHaveBeenCalledTimes(2);
			expect(log).toHaveBeenNthCalledWith(
				1,
				"http.requests",
				{ method: "GET", route: "/api/v2/workspaces/{id}" },
				{
					window_seconds: 2,
					count_2xx: 2,
					count_3xx: 0,
					count_4xx: 0,
					count_5xx: 0,
					count_network_error: 0,
					avg_duration_ms: 150,
					p95_duration_ms: 200,
				},
			);
			expect(log).toHaveBeenNthCalledWith(
				2,
				"http.requests",
				{ method: "POST", route: "/api/v2/workspaces/{id}" },
				expect.objectContaining({
					window_seconds: 2,
					count_2xx: 1,
				}),
			);
		} finally {
			rollup.dispose();
		}
	});

	it("counts status code classes and network errors", async () => {
		const { rollup, log } = createHarness(1);
		try {
			const route = "/api/v2/users/danny/workspaces";
			recordResponse(rollup, { method: "POST", url: route, status: 201 });
			recordResponse(rollup, { method: "POST", url: route, status: 302 });
			recordAxiosError(rollup, { method: "POST", url: route, status: 404 });
			recordAxiosError(rollup, { method: "POST", url: route, status: 500 });
			recordAxiosError(rollup, { method: "POST", url: route });

			await vi.advanceTimersByTimeAsync(1000);

			expect(log).toHaveBeenCalledWith(
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
		} finally {
			rollup.dispose();
		}
	});

	it("emits nothing for empty windows", async () => {
		const { rollup, log } = createHarness(1);
		try {
			await vi.advanceTimersByTimeAsync(2000);

			expect(log).not.toHaveBeenCalled();
		} finally {
			rollup.dispose();
		}
	});

	it("calculates nearest-rank p95", async () => {
		const { rollup, log } = createHarness(1);
		try {
			for (const durationMs of [
				10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
				170, 180, 190, 200,
			]) {
				recordResponse(rollup, {
					method: "GET",
					url: "/api/v2/workspaces/ws-id",
					status: 200,
					durationMs,
				});
			}

			await vi.advanceTimersByTimeAsync(1000);

			expect(log).toHaveBeenCalledWith(
				"http.requests",
				{ method: "GET", route: "/api/v2/workspaces/{id}" },
				expect.objectContaining({
					avg_duration_ms: 105,
					p95_duration_ms: 190,
				}),
			);
		} finally {
			rollup.dispose();
		}
	});

	it.each([
		["/api/v2/workspaces/abc-123?foo=bar", "/api/v2/workspaces/{id}"],
		[
			"/api/v2/users/danny/workspace/my-workspace?foo=bar",
			"/api/v2/users/{name}/workspace/{name}",
		],
		["/api/v2/users/danny/keys/123", "/api/v2/users/{name}/keys/{id}"],
		["/api/v2/tasks/danny/task-123", "/api/v2/tasks/{name}/{id}"],
		[
			"/api/v2/organizations/9f0f7f37-dfb7-4f4b-bcb8-c7062c7550fc/templates/base/versions/v1",
			"/api/v2/organizations/{id}/templates/{name}/versions/{name}",
		],
		[
			"/api/v2/workspaceagents/9f0f7f37-dfb7-4f4b-bcb8-c7062c7550fc/logs",
			"/api/v2/workspaceagents/{id}/logs",
		],
		[
			"/api/v2/workspaces/123/builds/456",
			"/api/v2/workspaces/{id}/builds/{id}",
		],
		["http://%", "<unknown>"],
	])("normalizes %s", (url, expected) => {
		expect(normalizeHttpRoute(url)).toBe(expected);
	});
});

function createHarness(windowSeconds = 60): Harness {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

	const log = vi.fn();
	const reporter: TelemetryReporter = {
		...NOOP_TELEMETRY_REPORTER,
		log,
	};
	return {
		rollup: new HttpRequestsTelemetry(reporter, { windowSeconds }),
		log,
	};
}

function recordResponse(
	rollup: HttpRequestsTelemetry,
	options: RequestOptions,
): void {
	rollup.recordResponse(makeResponse(options));
}

function recordAxiosError(
	rollup: HttpRequestsTelemetry,
	options: RequestOptions,
): void {
	const config = makeRequestConfig(options);
	const response = options.status
		? makeResponse({ ...options, status: options.status })
		: undefined;
	rollup.recordError(
		new AxiosError("Request failed", undefined, config, {}, response),
	);
}

function makeResponse(options: RequestOptions): AxiosResponse {
	const status = options.status ?? 200;
	return {
		data: {},
		status,
		statusText: String(status),
		headers: {},
		config: makeRequestConfig(options),
	};
}

function makeRequestConfig(options: RequestOptions): RequestConfigWithMeta {
	return {
		headers: new AxiosHeaders(),
		method: options.method,
		url: options.url,
		metadata: {
			requestId: "test-request",
			startedAt: Date.now() - (options.durationMs ?? 0),
		},
	} as RequestConfigWithMeta;
}
