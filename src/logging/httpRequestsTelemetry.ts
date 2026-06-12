import { isAxiosError, type AxiosResponse } from "axios";

import {
	NOOP_TELEMETRY_REPORTER,
	type TelemetryReporter,
} from "../telemetry/reporter";

import { formatMethod } from "./formatters";
import { normalizeRoute } from "./routeNormalization";

import type { Disposable } from "vscode";

import type { RequestConfigWithMeta } from "./types";

const EVENT_NAME = "http.requests";
const WINDOW_SECONDS = 60;

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
		const route = normalizeRoute(config.url, config.baseURL);
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
				const counts: Record<string, number> = {
					"count.1xx": bucket.count1xx,
					"count.2xx": bucket.count2xx,
					"count.3xx": bucket.count3xx,
					"count.4xx": bucket.count4xx,
					"count.5xx": bucket.count5xx,
					"count.network_error": bucket.countNetworkError,
				};
				const measurements: Record<string, number> = {
					window_seconds: elapsedSeconds,
				};
				// Zero counters are omitted; absence reads as "none in this window".
				for (const [key, count] of Object.entries(counts)) {
					if (count > 0) {
						measurements[key] = count;
					}
				}
				// Percentiles are omitted when no request carried timing metadata.
				if (bucket.durationsMs.length > 0) {
					const sorted = bucket.durationsMs.toSorted((a, b) => a - b);
					measurements["duration.p50_ms"] = percentile(sorted, 0.5);
					measurements["duration.p95_ms"] = percentile(sorted, 0.95);
					measurements["duration.p99_ms"] = percentile(sorted, 0.99);
				}
				this.#telemetry.log(EVENT_NAME, { method, route }, measurements);
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

function elapsedMs(
	config: RequestConfigWithMeta | undefined,
): number | undefined {
	const startedAt = config?.metadata?.startedAt;
	return typeof startedAt === "number"
		? Math.max(0, Date.now() - startedAt)
		: undefined;
}

function percentile(sortedValues: readonly number[], p: number): number {
	// Indexing an empty array would return undefined as a number.
	if (sortedValues.length === 0) {
		return 0;
	}
	const index = Math.ceil(sortedValues.length * p) - 1;
	return sortedValues[Math.max(0, index)];
}
