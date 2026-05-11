import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";

import {
	HttpRequestsTelemetry,
	normalizeHttpRoute,
} from "@/logging/httpRequestsTelemetry";
import {
	NOOP_TELEMETRY_REPORTER,
	type TelemetryReporter,
} from "@/telemetry/reporter";

import type { RequestConfigWithMeta } from "@/logging/types";

interface RequestOptions {
	readonly method?: string;
	readonly url: string;
	readonly status?: number;
	readonly durationMs?: number;
}

describe("HttpRequestsTelemetry", () => {
	let log: Mock<TelemetryReporter["log"]>;
	let rollup: HttpRequestsTelemetry;

	const start = (windowSeconds: number) => {
		const reporter: TelemetryReporter = { ...NOOP_TELEMETRY_REPORTER, log };
		rollup = new HttpRequestsTelemetry(reporter, { windowSeconds });
		return rollup;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		log = vi.fn();
	});

	afterEach(() => {
		rollup?.dispose();
		vi.useRealTimers();
	});

	it("emits one event per active method and route at the window boundary", async () => {
		start(2);
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
			expect.objectContaining({ window_seconds: 2, count_2xx: 1 }),
		);
	});

	it("counts status code classes and network errors", async () => {
		start(1);
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
	});

	it("emits nothing for empty windows", async () => {
		start(1);
		await vi.advanceTimersByTimeAsync(2000);
		expect(log).not.toHaveBeenCalled();
	});

	it("calculates nearest-rank p95", async () => {
		start(1);
		for (let durationMs = 10; durationMs <= 200; durationMs += 10) {
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
			expect.objectContaining({ avg_duration_ms: 105, p95_duration_ms: 190 }),
		);
	});

	it("skips duration when request metadata is missing", async () => {
		start(1);
		rollup.recordResponse({
			data: {},
			status: 200,
			statusText: "OK",
			headers: {},
			config: {
				headers: new AxiosHeaders(),
				method: "GET",
				url: "/api/v2/workspaces/abc",
			},
		} as AxiosResponse);

		await vi.advanceTimersByTimeAsync(1000);

		expect(log).toHaveBeenCalledWith(
			"http.requests",
			{ method: "GET", route: "/api/v2/workspaces/{id}" },
			expect.objectContaining({
				count_2xx: 1,
				avg_duration_ms: 0,
				p95_duration_ms: 0,
			}),
		);
	});

	it("re-flushes and reschedules after updateConfig changes the window", async () => {
		start(10);
		recordResponse(rollup, {
			method: "GET",
			url: "/api/v2/workspaces/abc",
			status: 200,
		});

		rollup.updateConfig({ windowSeconds: 1 });

		// updateConfig flushes pending buckets immediately under the old window.
		expect(log).toHaveBeenCalledWith(
			"http.requests",
			{ method: "GET", route: "/api/v2/workspaces/{id}" },
			expect.objectContaining({ window_seconds: 10 }),
		);

		recordResponse(rollup, {
			method: "GET",
			url: "/api/v2/workspaces/abc",
			status: 200,
		});
		await vi.advanceTimersByTimeAsync(1000);

		expect(log).toHaveBeenLastCalledWith(
			"http.requests",
			{ method: "GET", route: "/api/v2/workspaces/{id}" },
			expect.objectContaining({ window_seconds: 1 }),
		);
	});

	it("ignores non-axios errors", async () => {
		start(1);
		rollup.recordError(new Error("not an axios error"));
		rollup.recordError("string error");

		await vi.advanceTimersByTimeAsync(1000);
		expect(log).not.toHaveBeenCalled();
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

function recordResponse(
	rollup: HttpRequestsTelemetry,
	options: RequestOptions,
): void {
	rollup.recordResponse({
		data: {},
		status: options.status ?? 200,
		statusText: "",
		headers: {},
		config: makeRequestConfig(options),
	} as AxiosResponse);
}

function recordAxiosError(
	rollup: HttpRequestsTelemetry,
	options: RequestOptions,
): void {
	const config = makeRequestConfig(options);
	const response = options.status
		? ({
				data: {},
				status: options.status,
				statusText: "",
				headers: {},
				config,
			} as AxiosResponse)
		: undefined;
	rollup.recordError(
		new AxiosError("Request failed", undefined, config, {}, response),
	);
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
