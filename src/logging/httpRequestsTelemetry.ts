import { isAxiosError, type AxiosResponse } from "axios";

import { formatMethod } from "./formatters";

import type { Disposable } from "vscode";

import type { HttpRequestsTelemetryConfig } from "../settings/telemetry";
import type { TelemetryReporter } from "../telemetry/reporter";

import type { RequestConfigWithMeta } from "./types";

const EVENT_NAME = "http.requests";
const UNKNOWN_ROUTE = "<unknown>";

const ID_PLACEHOLDER = "{id}";
const NAME_PLACEHOLDER = "{name}";

export const ROUTE_NORMALIZATION_RULES: ReadonlyArray<readonly string[]> = [
	"api/v2/users/{name}/workspace/{name}",
	"api/v2/users/{name}/keys/{id}",
	"api/v2/users/{name}",
	"api/v2/tasks/{name}/{id}",
	"api/v2/tasks/{name}",
	"api/v2/organizations/{id}/templates/{name}/versions/{name}",
	"api/v2/organizations/{id}/templates/{name}",
	"api/v2/organizations/{id}/groups/{name}",
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
	"api/v2/workspaces/{id}",
].map((rule) => rule.split("/"));

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;

interface HttpRequestBucket {
	count2xx: number;
	count3xx: number;
	count4xx: number;
	count5xx: number;
	countNetworkError: number;
	durationsMs: number[];
}

export class HttpRequestsTelemetry implements Disposable {
	readonly #telemetry: TelemetryReporter;
	#windowSeconds: number;
	#timer: NodeJS.Timeout | null = null;
	#disposed = false;
	readonly #buckets = new Map<string, Map<string, HttpRequestBucket>>();

	public constructor(
		telemetry: TelemetryReporter,
		config: HttpRequestsTelemetryConfig,
	) {
		this.#telemetry = telemetry;
		this.#windowSeconds = config.windowSeconds;
		this.#scheduleNextWindow();
	}

	public updateConfig(config: HttpRequestsTelemetryConfig): void {
		if (config.windowSeconds === this.#windowSeconds) {
			return;
		}
		this.#flush();
		this.#windowSeconds = config.windowSeconds;
		this.#scheduleNextWindow();
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
		this.#disposed = true;
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		this.#buckets.clear();
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
		for (const [method, byRoute] of this.#buckets) {
			for (const [route, bucket] of byRoute) {
				this.#telemetry.log(
					EVENT_NAME,
					{ method, route },
					{
						window_seconds: this.#windowSeconds,
						count_2xx: bucket.count2xx,
						count_3xx: bucket.count3xx,
						count_4xx: bucket.count4xx,
						count_5xx: bucket.count5xx,
						count_network_error: bucket.countNetworkError,
						avg_duration_ms: average(bucket.durationsMs),
						p95_duration_ms: percentile95(bucket.durationsMs),
					},
				);
			}
		}
		this.#buckets.clear();
	}

	#scheduleNextWindow(): void {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		if (this.#disposed) {
			return;
		}
		this.#timer = setTimeout(() => {
			try {
				this.#flush();
			} finally {
				this.#scheduleNextWindow();
			}
		}, this.#windowSeconds * 1000);
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
	return `/${segments.map(normalizeIdSegment).join("/")}`;
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

	return `/${[
		...normalized,
		...segments.slice(rule.length).map(normalizeIdSegment),
	].join("/")}`;
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

function normalizeIdSegment(segment: string): string {
	return UUID.test(segment) || NUMERIC.test(segment) ? ID_PLACEHOLDER : segment;
}

function elapsedMs(
	config: RequestConfigWithMeta | undefined,
): number | undefined {
	const startedAt = config?.metadata?.startedAt;
	return typeof startedAt === "number"
		? Math.max(0, Date.now() - startedAt)
		: undefined;
}

function average(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile95(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.ceil(sorted.length * 0.95) - 1;
	return sorted[Math.max(0, index)];
}
