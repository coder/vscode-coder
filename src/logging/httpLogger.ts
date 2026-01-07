import { isAxiosError, type AxiosResponse } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";

import { getErrorDetail } from "../error/errorUtils";

import {
	formatBody,
	formatHeaders,
	formatMethod,
	formatSize,
	formatTime,
	formatUri,
} from "./formatters";
import {
	HttpClientLogLevel,
	type RequestConfigWithMeta,
	type RequestMeta,
} from "./types";
import { createRequestId, shortId } from "./utils";

import type { Logger } from "./logger";

/**
 * Creates metadata for tracking HTTP requests.
 */
export function createRequestMeta(): RequestMeta {
	return {
		requestId: createRequestId(),
		startedAt: Date.now(),
	};
}

/**
 * Logs an outgoing HTTP RESTful request.
 */
export function logRequest(
	logger: Logger,
	config: RequestConfigWithMeta,
	logLevel: HttpClientLogLevel,
): void {
	if (logLevel === HttpClientLogLevel.NONE) {
		return;
	}

	const { requestId, method, url, requestSize } = parseConfig(config);

	const msg = [
		`→ ${shortId(requestId)} ${method} ${url} ${requestSize}`,
		...buildExtraLogs(config.headers, config.data, logLevel),
	];
	logger.trace(msg.join("\n"));
}

/**
 * Logs an incoming HTTP RESTful response.
 */
export function logResponse(
	logger: Logger,
	response: AxiosResponse,
	logLevel: HttpClientLogLevel,
): void {
	if (logLevel === HttpClientLogLevel.NONE) {
		return;
	}

	const { requestId, method, url, time, responseSize } = parseConfig(
		response.config,
	);

	const msg = [
		`← ${shortId(requestId)} ${response.status} ${method} ${url} ${responseSize} ${time}`,
		...buildExtraLogs(response.headers, response.data, logLevel),
	];
	logger.trace(msg.join("\n"));
}

/**
 * Logs HTTP RESTful request errors and failures.
 *
 * Note: Errors are always logged regardless of log level.
 */
export function logError(
	logger: Logger,
	error: unknown,
	logLevel: HttpClientLogLevel,
): void {
	if (isAxiosError(error)) {
		const config = error.config as RequestConfigWithMeta | undefined;
		const { requestId, method, url, time } = parseConfig(config);

		const errMsg = getErrorMessage(error, "");
		const detail = getErrorDetail(error) ?? "";
		const errorParts = [errMsg, detail]
			.map((part) => part.trim())
			.filter(Boolean);

		let logPrefix: string;
		let extraLines: string[];
		if (error.response) {
			if (errorParts.length === 0) {
				errorParts.push(
					error.response.statusText ||
						String(error.response.data).slice(0, 100) ||
						"No error info",
				);
			}

			logPrefix = `← ${shortId(requestId)} ${error.response.status} ${method} ${url} ${time}`;
			extraLines = buildExtraLogs(
				error.response.headers,
				error.response.data,
				logLevel,
			);
		} else {
			if (errorParts.length === 0) {
				errorParts.push(error.code || "Network error");
			}
			logPrefix = `✗ ${shortId(requestId)} ${method} ${url} ${time}`;
			extraLines = buildExtraLogs(
				error?.config?.headers ?? {},
				error.config?.data,
				logLevel,
			);
		}

		const msg = [[logPrefix, ...errorParts].join(" - "), ...extraLines];
		logger.error(msg.join("\n"));
	} else {
		logger.error("Request error", error);
	}
}

function buildExtraLogs(
	headers: Record<string, unknown>,
	body: unknown,
	logLevel: HttpClientLogLevel,
) {
	const msg = [];
	if (logLevel >= HttpClientLogLevel.HEADERS) {
		msg.push(formatHeaders(headers));
	}
	if (logLevel >= HttpClientLogLevel.BODY) {
		msg.push(formatBody(body));
	}
	return msg;
}

function parseConfig(config: RequestConfigWithMeta | undefined): {
	requestId: string;
	method: string;
	url: string;
	time: string;
	requestSize: string;
	responseSize: string;
} {
	const meta = config?.metadata;
	return {
		requestId: meta?.requestId || "unknown",
		method: formatMethod(config?.method),
		url: formatUri(config),
		time: meta ? formatTime(Date.now() - meta.startedAt) : "?ms",
		requestSize: formatSize(config?.rawRequestSize),
		responseSize: formatSize(config?.rawResponseSize),
	};
}
