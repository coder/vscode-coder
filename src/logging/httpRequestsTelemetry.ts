import { isAxiosError, type AxiosResponse } from "axios";

import {
	NOOP_TELEMETRY_REPORTER,
	type TelemetryReporter,
} from "../telemetry/reporter";

import { formatMethod } from "./formatters";

import type { Disposable } from "vscode";

import type { RequestConfigWithMeta } from "./types";

const EVENT_NAME = "http.requests";
const UNKNOWN_ROUTE = "<unknown>";
const WINDOW_SECONDS = 60;

const ID_PLACEHOLDER = "{id}";
const NAME_PLACEHOLDER = "{name}";

const ROUTE_NORMALIZATION_RULES: ReadonlyArray<readonly string[]> = [
	"api/v2/users/{name}/workspace/{name}",
	"api/v2/users/{name}/keys/{id}",
	"api/v2/users/{name}",
	"api/v2/tasks/{name}/{id}",
	"api/v2/tasks/{name}",
	"api/v2/organizations/{id}/templates/{name}/versions/{name}",
	"api/v2/organizations/{id}/templates/{name}",
	"api/v2/organizations/{id}/groups/{name}",
	"api/v2/organizations/{id}/members/{name}",
	"api/v2/organizations/{id}",
	"api/v2/aibridge/sessions/{id}",
	"api/v2/files/{id}",
	"api/v2/groups/{id}",
	"api/v2/licenses/{id}",
	"api/v2/oauth2-provider/apps/{id}",
	"api/v2/templates/{id}",
	"api/v2/templateversions/{id}",
	"api/v2/workspaceagents/{id}",
	"api/v2/workspacebuilds/{id}",
	"api/v2/workspaces/{id}/builds/{id}",
	"api/v2/workspaces/{id}",
].map((rule) => rule.split("/"));

interface HttpRequestBucket {
	count1xx: number;
	count2xx: number;
	count3xx: number;
	count4xx: number;
	count5xx: number;
	countNetworkError: number;
	durationsMs: number[];
}

/**
 * Rolls up HTTP request counts and latencies into "http.requests" events
 * every 60 seconds. Construct with NOOP_TELEMETRY_REPORTER to skip the
 * timer so throwaway clients don't leak it.
 */
export class HttpRequestsTelemetry implements Disposable {
	readonly #telemetry: TelemetryReporter;
	#timer: NodeJS.Timeout | null = null;
	#disposed = false;
	#windowStartedAt = Date.now();
	readonly #buckets = new Map<string, Map<string, HttpRequestBucket>>();

	public constructor(telemetry: TelemetryReporter) {
		this.#telemetry = telemetry;
		if (telemetry !== NOOP_TELEMETRY_REPORTER) {
			this.#scheduleNextWindow();
		}
	}

	public recordResponse(response: AxiosResponse): void {
		this.#record(
			response.config as RequestConfigWithMeta,
			response.status,
			false,
		);
	}

	public recordError(error: unknown): void {
		if (!isAxiosError(error) || !error.config) {
			return;
		}
		this.#record(
			error.config as RequestConfigWithMeta,
			error.response?.status,
			!error.response,
		);
	}

	public dispose(): void {
		if (this.#disposed) {
			return;
		}
		try {
			this.#flush();
		} finally {
			this.#disposed = true;
			if (this.#timer) {
				clearTimeout(this.#timer);
				this.#timer = null;
			}
		}
	}

	#record(
		config: RequestConfigWithMeta,
		statusCode: number | undefined,
		networkError: boolean,
	): void {
		if (this.#disposed) {
			return;
		}

		const method = formatMethod(config.method);
		const route = normalizeHttpRoute(config.url, config.baseURL);
		const bucket = this.#getOrCreateBucket(method, route);

		const durationMs = elapsedMs(config);
		if (durationMs !== undefined) {
			bucket.durationsMs.push(durationMs);
		}

		if (networkError || statusCode === undefined) {
			bucket.countNetworkError += 1;
		} else if (statusCode >= 100 && statusCode < 200) {
			bucket.count1xx += 1;
		} else if (statusCode >= 200 && statusCode < 300) {
			bucket.count2xx += 1;
		} else if (statusCode >= 300 && statusCode < 400) {
			bucket.count3xx += 1;
		} else if (statusCode >= 400 && statusCode < 500) {
			bucket.count4xx += 1;
		} else if (statusCode >= 500 && statusCode < 600) {
			bucket.count5xx += 1;
		} else {
			bucket.countNetworkError += 1;
		}
	}

	#getOrCreateBucket(method: string, route: string): HttpRequestBucket {
		let byRoute = this.#buckets.get(method);
		if (!byRoute) {
			byRoute = new Map();
			this.#buckets.set(method, byRoute);
		}
		let bucket = byRoute.get(route);
		if (!bucket) {
			bucket = {
				count1xx: 0,
				count2xx: 0,
				count3xx: 0,
				count4xx: 0,
				count5xx: 0,
				countNetworkError: 0,
				durationsMs: [],
			};
			byRoute.set(route, bucket);
		}
		return bucket;
	}

	#flush(): void {
		const elapsedSeconds = Math.max(
			1,
			Math.round((Date.now() - this.#windowStartedAt) / 1000),
		);
		for (const [method, byRoute] of this.#buckets) {
			for (const [route, bucket] of byRoute) {
				const sortedDurations = bucket.durationsMs.toSorted((a, b) => a - b);
				this.#telemetry.log(
					EVENT_NAME,
					{ method, route },
					{
						window_seconds: elapsedSeconds,
						count_1xx: bucket.count1xx,
						count_2xx: bucket.count2xx,
						count_3xx: bucket.count3xx,
						count_4xx: bucket.count4xx,
						count_5xx: bucket.count5xx,
						count_network_error: bucket.countNetworkError,
						p50_duration_ms: percentile(sortedDurations, 0.5),
						p95_duration_ms: percentile(sortedDurations, 0.95),
						p99_duration_ms: percentile(sortedDurations, 0.99),
					},
				);
			}
		}
		this.#buckets.clear();
		this.#windowStartedAt = Date.now();
	}

	#scheduleNextWindow(): void {
		if (this.#disposed) {
			return;
		}
		this.#timer = setTimeout(() => {
			try {
				this.#flush();
			} finally {
				this.#scheduleNextWindow();
			}
		}, WINDOW_SECONDS * 1000);
	}
}

export function normalizeHttpRoute(
	url: string | undefined,
	baseURL?: string,
): string {
	if (!url) {
		return UNKNOWN_ROUTE;
	}

	const segments = parsePathSegments(url, baseURL);
	if (segments.length === 0) {
		return UNKNOWN_ROUTE;
	}

	for (const rule of ROUTE_NORMALIZATION_RULES) {
		const normalized = normalizeByRule(segments, rule);
		if (normalized) {
			return normalized;
		}
	}
	// No matching rule. Pass through; add a rule above if cardinality grows.
	return `/${segments.join("/")}`;
}

function normalizeByRule(
	segments: readonly string[],
	rule: readonly string[],
): string | undefined {
	if (segments.length < rule.length) {
		return undefined;
	}

	const normalized: string[] = [];
	for (const [index, ruleSegment] of rule.entries()) {
		if (ruleSegment === ID_PLACEHOLDER || ruleSegment === NAME_PLACEHOLDER) {
			normalized.push(ruleSegment);
			continue;
		}
		if (segments[index] !== ruleSegment) {
			return undefined;
		}
		normalized.push(segments[index]);
	}

	// Trailing segments pass through. If a tail can hold an ID, add a rule.
	return `/${[...normalized, ...segments.slice(rule.length)].join("/")}`;
}

function parsePathSegments(url: string, baseURL?: string): string[] {
	try {
		return new URL(url, baseURL ?? "http://coder.invalid").pathname
			.split("/")
			.filter(Boolean);
	} catch {
		return [];
	}
}

function elapsedMs(
	config: RequestConfigWithMeta | undefined,
): number | undefined {
	const startedAt = config?.metadata?.startedAt;
	return typeof startedAt === "number"
		? Math.max(0, Date.now() - startedAt)
		: undefined;
}

function percentile(sortedValues: readonly number[], p: number): number {
	if (sortedValues.length === 0) {
		return 0;
	}
	const index = Math.ceil(sortedValues.length * p) - 1;
	return sortedValues[Math.max(0, index)];
}
