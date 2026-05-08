import { isAxiosError, type AxiosResponse } from "axios";
import * as vscode from "vscode";

import { watchConfigurationChanges } from "../configWatcher";
import {
	LOCAL_TELEMETRY_SETTING,
	readHttpRequestsTelemetryConfig,
	type HttpRequestsTelemetryConfig,
} from "../settings/telemetry";
import { type TelemetryReporter } from "../telemetry/reporter";

import { formatMethod } from "./formatters";

import type { RequestConfigWithMeta } from "./types";

const EVENT_NAME = "http.requests";
const UNKNOWN_ROUTE = "<unknown>";

interface RouteNormalizationRule {
	readonly pattern: RegExp;
	readonly replacement: string;
}

const ID_RESOURCES = [
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
	{
		pattern: /^(\/api\/v2\/users\/)[^/]+(\/workspace\/)[^/]+(?=$|\/)/,
		replacement: "$1{name}$2{name}",
	},
	{
		pattern: /^(\/api\/v2\/users\/)[^/]+(?=$|\/)/,
		replacement: "$1{name}",
	},
	{
		pattern: /^(\/api\/v2\/tasks\/)[^/]+(?=$|\/)/,
		replacement: "$1{name}",
	},
	{
		pattern:
			/^(\/api\/v2\/organizations\/)[^/]+(\/templates\/)[^/]+(\/versions\/)[^/]+(?=$|\/)/,
		replacement: "$1{id}$2{name}$3{name}",
	},
	{
		pattern: /^(\/api\/v2\/organizations\/)[^/]+(\/templates\/)[^/]+(?=$|\/)/,
		replacement: "$1{id}$2{name}",
	},
	{
		pattern: /^(\/api\/v2\/organizations\/)[^/]+(\/groups\/)[^/]+(?=$|\/)/,
		replacement: "$1{id}$2{name}",
	},
	{
		pattern: /^(\/api\/v2\/organizations\/)[^/]+(?=$|\/)/,
		replacement: "$1{id}",
	},
	...ID_RESOURCES.map((resource) => ({
		pattern: new RegExp(`^(\\/api\\/v2\\/${resource}\\/)[^/]+(?=$|\\/)`),
		replacement: "$1{id}",
	})),
];

const UUID_SEGMENT =
	/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=$|\/)/gi;
const NUMERIC_SEGMENT = /\/\d+(?=$|\/)/g;

export interface HttpRequestTelemetrySample {
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

export class HttpRequestsTelemetry implements vscode.Disposable {
	readonly #telemetry: TelemetryReporter;
	#config: HttpRequestsTelemetryConfig;
	#timer: NodeJS.Timeout | null = null;
	#configWatcher: vscode.Disposable | null = null;
	#disposed = false;
	readonly #buckets = new Map<string, HttpRequestBucket>();

	private constructor(
		telemetry: TelemetryReporter,
		config: HttpRequestsTelemetryConfig,
	) {
		this.#telemetry = telemetry;
		this.#config = config;
	}

	public static start(telemetry: TelemetryReporter): HttpRequestsTelemetry {
		const rollup = new HttpRequestsTelemetry(
			telemetry,
			readHttpRequestsTelemetryConfig(vscode.workspace.getConfiguration()),
		);
		rollup.#configWatcher = rollup.#watchConfig();
		rollup.#scheduleNextWindow();
		return rollup;
	}

	public recordResponse(response: AxiosResponse): void {
		this.record({
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

		this.record({
			method: config.method,
			url: config.url,
			baseURL: config.baseURL,
			statusCode: error.response?.status,
			networkError: !error.response,
			durationMs: durationFromConfig(config),
		});
	}

	public record(sample: HttpRequestTelemetrySample): void {
		if (this.#disposed) {
			return;
		}

		const method = formatMethod(sample.method);
		const route = normalizeHttpRoute(sample.url, sample.baseURL);
		const key = bucketKey(method, route);
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

	public flush(): void {
		const buckets = [...this.#buckets.entries()];
		this.#buckets.clear();
		for (const [key, bucket] of buckets) {
			const { method, route } = parseBucketKey(key);
			this.#telemetry.log(
				EVENT_NAME,
				{ method, route },
				{
					window_seconds: this.#config.windowSeconds,
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
		this.#configWatcher?.dispose();
		this.#configWatcher = null;
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		this.#buckets.clear();
	}

	#watchConfig(): vscode.Disposable {
		return watchConfigurationChanges(
			[
				{
					setting: LOCAL_TELEMETRY_SETTING,
					getValue: () =>
						readHttpRequestsTelemetryConfig(
							vscode.workspace.getConfiguration(),
						),
				},
			],
			(changes) => {
				const next = changes.get(LOCAL_TELEMETRY_SETTING) as
					| HttpRequestsTelemetryConfig
					| undefined;
				if (!next) {
					return;
				}
				this.flush();
				this.#config = next;
				this.#scheduleNextWindow();
			},
		);
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
			this.flush();
			this.#scheduleNextWindow();
		}, this.#config.windowSeconds * 1000);
	}
}

export function normalizeHttpRoute(
	url: string | undefined,
	baseURL?: string,
): string {
	if (!url) {
		return UNKNOWN_ROUTE;
	}

	let route = parsePathname(url, baseURL);
	for (const rule of ROUTE_NORMALIZATION_RULES) {
		route = route.replace(rule.pattern, rule.replacement);
	}
	return route.replace(UUID_SEGMENT, "/{id}").replace(NUMERIC_SEGMENT, "/{id}");
}

function parsePathname(url: string, baseURL?: string): string {
	try {
		return new URL(url, baseURL ?? "http://coder.invalid").pathname;
	} catch {
		const withoutQuery = url.split("?", 1)[0] || UNKNOWN_ROUTE;
		return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
	}
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
