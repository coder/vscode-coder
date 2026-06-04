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

import { HttpRequestsTelemetry } from "@/logging/httpRequestsTelemetry";
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

// Mirrors WINDOW_SECONDS in src/logging/httpRequestsTelemetry.ts.
const WINDOW_SECONDS = 60;

describe("HttpRequestsTelemetry", () => {
	let log: Mock<TelemetryReporter["log"]>;
	let rollup: HttpRequestsTelemetry;

	const start = () => {
		const reporter: TelemetryReporter = { ...NOOP_TELEMETRY_REPORTER, log };
		rollup = new HttpRequestsTelemetry(reporter);
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
		start();
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

		await advanceOneWindow();

		expect(log).toHaveBeenCalledTimes(2);
		expect(log).toHaveBeenNthCalledWith(
			1,
			"http.requests",
			{ method: "GET", route: "/api/v2/workspaces/{id}" },
			{
				window_seconds: WINDOW_SECONDS,
				"count.1xx": 0,
				"count.2xx": 2,
				"count.3xx": 0,
				"count.4xx": 0,
				"count.5xx": 0,
				"count.network_error": 0,
				"duration.p50_ms": 100,
				"duration.p95_ms": 200,
				"duration.p99_ms": 200,
			},
		);
		expect(log).toHaveBeenNthCalledWith(
			2,
			"http.requests",
			{ method: "POST", route: "/api/v2/workspaces/{id}" },
			expect.objectContaining({ "count.2xx": 1 }),
		);
	});

	it("counts status code classes and network errors", async () => {
		start();
		const route = "/api/v2/users/danny/workspaces";
		recordResponse(rollup, { method: "POST", url: route, status: 101 });
		recordResponse(rollup, { method: "POST", url: route, status: 201 });
		recordResponse(rollup, { method: "POST", url: route, status: 302 });
		recordAxiosError(rollup, { method: "POST", url: route, status: 404 });
		recordAxiosError(rollup, { method: "POST", url: route, status: 500 });
		recordAxiosError(rollup, { method: "POST", url: route });

		await advanceOneWindow();

		expect(log).toHaveBeenCalledWith(
			"http.requests",
			{ method: "POST", route: "/api/v2/users/{name}/workspaces" },
			expect.objectContaining({
				"count.1xx": 1,
				"count.2xx": 1,
				"count.3xx": 1,
				"count.4xx": 1,
				"count.5xx": 1,
				"count.network_error": 1,
			}),
		);
	});

	it("emits nothing for empty windows", async () => {
		start();
		await advanceOneWindow();
		expect(log).not.toHaveBeenCalled();
	});

	it("is inert when constructed with the NOOP reporter", async () => {
		// Throwaway clients pass NOOP and may never dispose, so no timer.
		rollup = new HttpRequestsTelemetry(NOOP_TELEMETRY_REPORTER);
		recordResponse(rollup, {
			method: "GET",
			url: "/api/v2/workspaces/abc",
			status: 200,
		});
		await vi.advanceTimersByTimeAsync(WINDOW_SECONDS * 10 * 1000);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("calculates nearest-rank p50, p95, p99", async () => {
		start();
		for (let durationMs = 10; durationMs <= 200; durationMs += 10) {
			recordResponse(rollup, {
				method: "GET",
				url: "/api/v2/workspaces/ws-id",
				status: 200,
				durationMs,
			});
		}

		await advanceOneWindow();

		expect(log).toHaveBeenCalledWith(
			"http.requests",
			{ method: "GET", route: "/api/v2/workspaces/{id}" },
			expect.objectContaining({
				"duration.p50_ms": 100,
				"duration.p95_ms": 190,
				"duration.p99_ms": 200,
			}),
		);
	});

	it("skips duration when request metadata is missing", async () => {
		start();
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

		await advanceOneWindow();

		expect(log).toHaveBeenCalledWith(
			"http.requests",
			{ method: "GET", route: "/api/v2/workspaces/{id}" },
			expect.objectContaining({
				"count.2xx": 1,
				"duration.p50_ms": 0,
				"duration.p95_ms": 0,
				"duration.p99_ms": 0,
			}),
		);
	});

	it("flushes any pending bucket on dispose", () => {
		start();
		recordResponse(rollup, {
			method: "GET",
			url: "/api/v2/workspaces/abc",
			status: 200,
		});

		rollup.dispose();

		expect(log).toHaveBeenCalledWith(
			"http.requests",
			{ method: "GET", route: "/api/v2/workspaces/{id}" },
			expect.objectContaining({ "count.2xx": 1 }),
		);
	});

	it("ignores non-axios errors", async () => {
		start();
		rollup.recordError(new Error("not an axios error"));
		rollup.recordError("string error");

		await advanceOneWindow();
		expect(log).not.toHaveBeenCalled();
	});
});

async function advanceOneWindow(): Promise<void> {
	await vi.advanceTimersByTimeAsync(WINDOW_SECONDS * 1000);
}

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
