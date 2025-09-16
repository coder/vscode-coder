import type {
	AxiosError,
	AxiosResponse,
	InternalAxiosRequestConfig,
} from "axios";
import { isAxiosError } from "axios";
import { getErrorMessage } from "coder/site/src/api/errors";
import { getErrorDetail } from "../error";
import {
	formatBody,
	formatContentLength,
	formatHeaders,
	formatMethod,
	formatTime,
	formatUri,
} from "./formatters";
import type { Logger } from "./logger";
import {
	HttpClientLogLevel,
	RequestConfigWithMeta,
	RequestMeta,
} from "./types";
import { createRequestId, shortId } from "./utils";

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
	const len = formatContentLength(config.headers, config.data);

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
	const len = formatContentLength(response.headers, response.data);

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

		const msg = getErrorMessage(error, "");
		const detail = getErrorDetail(error) ?? "";

		if (error.response) {
			const msgParts = [
				`← ${shortId(requestId)} ${error.response.status} ${method} ${url} ${time}`,
				msg,
				detail,
			];
			if (msg.trim().length === 0 && detail.trim().length === 0) {
				const responseData =
					error.response.statusText ||
					String(error.response.data).slice(0, 100) ||
					"No error info";
				msgParts.push(responseData);
			}

			const fullMsg = msgParts.map((str) => str.trim()).join(" - ");
			const headers = formatHeaders(error.response.headers);
			logger.error(`${fullMsg}\n${headers}`, error);
		} else {
			const reason = error.code || error.message || "Network error";
			const errorInfo = [msg, detail, reason].filter(Boolean).join(" - ");
			const headers = formatHeaders(config?.headers ?? {});
			logger.error(
				`✗ ${shortId(requestId)} ${method} ${url} ${time} - ${errorInfo}\n${headers}`,
				error,
			);
		}
	} else {
		logger.error("Request error", error);
	}
}
