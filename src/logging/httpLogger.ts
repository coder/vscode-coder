import type {
	InternalAxiosRequestConfig,
	AxiosResponse,
	AxiosError,
} from "axios";
import { isAxiosError } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";
import { getErrorDetail } from "../error";
import {
	formatHeaders,
	formatBody,
	formatUri,
	formatContentLength,
	formatMethod,
} from "./formatters";
import type { Logger } from "./logger";
import {
	HttpClientLogLevel,
	RequestMeta,
	RequestConfigWithMeta,
} from "./types";
import { shortId, formatTime, createRequestId } from "./utils";

export function createRequestMeta(): RequestMeta {
	return {
		requestId: createRequestId(),
		startedAt: Date.now(),
	};
}

export function logRequest(
	logger: Logger,
	requestId: string,
	config: InternalAxiosRequestConfig,
	logLevel: HttpClientLogLevel,
): void {
	if (logLevel === HttpClientLogLevel.NONE) {
		return;
	}

	const method = formatMethod(config.method);
	const url = formatUri(config);
	const len = formatContentLength(config.headers);

	let msg = `→ ${shortId(requestId)} ${method} ${url} ${len}`;
	if (logLevel >= HttpClientLogLevel.HEADERS) {
		msg += `\n${formatHeaders(config.headers)}`;
	}

	if (logLevel >= HttpClientLogLevel.BODY) {
		msg += `\n${formatBody(config.data)}`;
	}

	logger.trace(msg);
}

export function logResponse(
	logger: Logger,
	meta: RequestMeta,
	response: AxiosResponse,
	logLevel: HttpClientLogLevel,
): void {
	if (logLevel === HttpClientLogLevel.NONE) {
		return;
	}

	const method = formatMethod(response.config.method);
	const url = formatUri(response.config);
	const time = formatTime(Date.now() - meta.startedAt);
	const len = formatContentLength(response.headers);

	let msg = `← ${shortId(meta.requestId)} ${response.status} ${method} ${url} ${len} ${time}`;

	if (logLevel >= HttpClientLogLevel.HEADERS) {
		msg += `\n${formatHeaders(response.headers)}`;
	}

	if (logLevel >= HttpClientLogLevel.BODY) {
		msg += `\n${formatBody(response.data)}`;
	}

	logger.trace(msg);
}

export function logRequestError(
	logger: Logger,
	error: AxiosError | unknown,
): void {
	if (isAxiosError(error)) {
		const config = error.config as RequestConfigWithMeta | undefined;
		const meta = config?.metadata;
		const method = formatMethod(config?.method);
		const url = formatUri(config);
		const requestId = meta?.requestId || "unknown";
		const time = meta ? formatTime(Date.now() - meta.startedAt) : "?ms";

		const msg = getErrorMessage(error, "No error message");
		const detail = getErrorDetail(error) ?? "";

		if (error.response) {
			const responseData =
				error.response.statusText || String(error.response.data).slice(0, 100);
			const errorInfo = [msg, detail, responseData].filter(Boolean).join(" - ");
			logger.error(
				`← ${shortId(requestId)} ${error.response.status} ${method} ${url} ${time} - ${errorInfo}`,
				error,
			);
		} else {
			const reason = error.code || error.message || "Network error";
			const errorInfo = [msg, detail, reason].filter(Boolean).join(" - ");
			logger.error(
				`✗ ${shortId(requestId)} ${method} ${url} ${time} - ${errorInfo}`,
				error,
			);
		}
	} else {
		logger.error("Request error", error);
	}
}
