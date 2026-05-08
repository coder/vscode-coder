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
type Placeholder = typeof ID_PLACEHOLDER | typeof NAME_PLACEHOLDER;
type RouteNormalizationRule = readonly string[];

const route = (...segments: RouteNormalizationRule): RouteNormalizationRule =>
	segments;

const ID_RESOURCE_ROUTES = [
	"aibridge/sessions",
	"files",
	"groups",
	"licenses",
	"oauth2-provider/apps",
	"templates",
	"templateversions",
	"workspaceagents",
	"workspacebuilds",
	"workspaces",
] as const;

export const ROUTE_NORMALIZATION_RULES: readonly RouteNormalizationRule[] = [
	route("api", "v2", "users", NAME_PLACEHOLDER, "workspace", NAME_PLACEHOLDER),
	route("api", "v2", "users", NAME_PLACEHOLDER, "keys", ID_PLACEHOLDER),
	route("api", "v2", "users", NAME_PLACEHOLDER),
	route("api", "v2", "tasks", NAME_PLACEHOLDER, ID_PLACEHOLDER),
	route("api", "v2", "tasks", NAME_PLACEHOLDER),
	route(
		"api",
		"v2",
		"organizations",
		ID_PLACEHOLDER,
		"templates",
		NAME_PLACEHOLDER,
		"versions",
		NAME_PLACEHOLDER,
	),
	route(
		"api",
		"v2",
		"organizations",
		ID_PLACEHOLDER,
		"templates",
		NAME_PLACEHOLDER,
	),
	route(
		"api",
		"v2",
		"organizations",
		ID_PLACEHOLDER,
		"groups",
		NAME_PLACEHOLDER,
	),
	route("api", "v2", "organizations", ID_PLACEHOLDER),
	...ID_RESOURCE_ROUTES.map((resource) =>
		route("api", "v2", ...resource.split("/"), ID_PLACEHOLDER),
	),
];

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;

interface HttpRequestTelemetrySample {
	readonly method?: string;
	readonly url?: string;
	readonly baseURL?: string;
	readonly statusCode?: number;
	readonly networkError?: boolean;
	readonly durationMs?: number;
}

interface HttpRequestBucket {
	count2xx: number;
	count3xx: number;
	count4xx: number;
	count5xx: number;
	countNetworkError: number;
	durationsMs: number[];
}

export interface HttpRequestsTelemetryRecorder extends Disposable {
	recordResponse(response: AxiosResponse): void;
	recordError(error: unknown): void;
	updateConfig(config: HttpRequestsTelemetryConfig): void;
}

export const NOOP_HTTP_REQUESTS_TELEMETRY: HttpRequestsTelemetryRecorder = {
	recordResponse: () => undefined,
	recordError: () => undefined,
	updateConfig: () => undefined,
	dispose: () => undefined,
};

export class HttpRequestsTelemetry implements HttpRequestsTelemetryRecorder {
	readonly #telemetry: TelemetryReporter;
	#windowSeconds: number;
	#timer: NodeJS.Timeout | null = null;
	#disposed = false;
	readonly #buckets = new Map<string, HttpRequestBucket>();

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
		this.#record({
			method: response.config.method,
			url: response.config.url,
			baseURL: response.config.baseURL,
			statusCode: response.status,
			durationMs: durationFromConfig(response.config),
		});
	}

	public recordError(error: unknown): void {
		if (!isAxiosError(error)) {
			return;
		}

		const config = error.config as RequestConfigWithMeta | undefined;
		if (!config) {
			return;
		}

		this.#record({
			method: config.method,
			url: config.url,
			baseURL: config.baseURL,
			statusCode: error.response?.status,
			networkError: !error.response,
			durationMs: durationFromConfig(config),
		});
	}

	#flush(): void {
		const buckets = [...this.#buckets.entries()];
		this.#buckets.clear();
		for (const [key, bucket] of buckets) {
			const { method, route: normalizedRoute } = parseBucketKey(key);
			this.#telemetry.log(
				EVENT_NAME,
				{ method, route: normalizedRoute },
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

	public dispose(): void {
		this.#disposed = true;
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		this.#buckets.clear();
	}

	#record(sample: HttpRequestTelemetrySample): void {
		if (this.#disposed) {
			return;
		}

		const method = formatMethod(sample.method);
		const normalizedRoute = normalizeHttpRoute(sample.url, sample.baseURL);
		const key = bucketKey(method, normalizedRoute);
		const bucket = this.#buckets.get(key) ?? createBucket();
		this.#buckets.set(key, bucket);

		const durationMs = sanitizeDuration(sample.durationMs);
		bucket.durationsMs.push(durationMs);

		if (sample.networkError) {
			bucket.countNetworkError += 1;
			return;
		}

		const statusCode = sample.statusCode;
		if (statusCode === undefined) {
			bucket.countNetworkError += 1;
			return;
		}

		if (statusCode >= 200 && statusCode < 300) {
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

	#scheduleNextWindow(): void {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		if (this.#disposed) {
			return;
		}
		this.#timer = setTimeout(() => {
			this.#flush();
			this.#scheduleNextWindow();
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
	rule: RouteNormalizationRule,
): string | undefined {
	if (segments.length < rule.length) {
		return undefined;
	}

	const normalized: string[] = [];
	for (const [index, ruleSegment] of rule.entries()) {
		if (isPlaceholder(ruleSegment)) {
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

function isPlaceholder(segment: string): segment is Placeholder {
	return segment === ID_PLACEHOLDER || segment === NAME_PLACEHOLDER;
}

function normalizeIdSegment(segment: string): string {
	return UUID.test(segment) || NUMERIC.test(segment) ? ID_PLACEHOLDER : segment;
}

function durationFromConfig(config: RequestConfigWithMeta | undefined): number {
	const startedAt = config?.metadata?.startedAt;
	return typeof startedAt === "number" ? Date.now() - startedAt : 0;
}

function sanitizeDuration(durationMs: number | undefined): number {
	return typeof durationMs === "number" && Number.isFinite(durationMs)
		? Math.max(0, durationMs)
		: 0;
}

function createBucket(): HttpRequestBucket {
	return {
		count2xx: 0,
		count3xx: 0,
		count4xx: 0,
		count5xx: 0,
		countNetworkError: 0,
		durationsMs: [],
	};
}

function average(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile95(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.ceil(sorted.length * 0.95) - 1;
	return sorted[Math.max(0, index)];
}

function bucketKey(method: string, route: string): string {
	return `${method}\n${route}`;
}

function parseBucketKey(key: string): { method: string; route: string } {
	const [method, route] = key.split("\n", 2);
	return { method, route };
}
