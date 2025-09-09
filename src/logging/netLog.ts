import {
	type InternalAxiosRequestConfig,
	type AxiosResponse,
	type AxiosError,
	isAxiosError,
} from "axios";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import type * as vscode from "vscode";
import { errToStr } from "../api-helper";

export interface RequestMeta {
	requestId: string;
	startedAt: number;
}

export type RequestConfigWithMeta = InternalAxiosRequestConfig & {
	metadata?: RequestMeta;
};

function shortId(id: string): string {
	return id.slice(0, 8);
}

function sizeOf(data: unknown): number {
	if (data === null || data === undefined) {
		return 0;
	}
	if (typeof data === "string") {
		return Buffer.byteLength(data);
	}
	if (Buffer.isBuffer(data)) {
		return data.length;
	}
	if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
		return data.byteLength;
	}
	if (
		typeof data === "object" &&
		"size" in data &&
		typeof data.size === "number"
	) {
		return data.size;
	}
	return 0;
}

export function createRequestMeta(): RequestMeta {
	return {
		requestId: crypto.randomUUID().replace(/-/g, ""),
		startedAt: Date.now(),
	};
}

export function logRequestStart(
	logger: vscode.LogOutputChannel,
	requestId: string,
	config: InternalAxiosRequestConfig,
): void {
	const method = (config.method ?? "GET").toUpperCase();
	const url = config.url || "";
	const len = config.headers?.["content-length"] as string | undefined;
	const lenStr = len ? ` (${len}b)` : "";
	logger.trace(`→ ${shortId(requestId)} ${method} ${url}${lenStr}`);
}

export function logRequestSuccess(
	logger: vscode.LogOutputChannel,
	meta: RequestMeta,
	response: AxiosResponse,
): void {
	const method = (response.config.method ?? "GET").toUpperCase();
	const url = response.config.url || "";
	const len = response.headers?.["content-length"] as string | undefined;
	const ms = Date.now() - meta.startedAt;
	const lenStr = len ? ` (${len}b)` : "";
	logger.trace(
		`← ${shortId(meta.requestId)} ${response.status} ${method} ${url} ${ms}ms${lenStr}`,
	);
}

export function logRequestError(
	logger: vscode.LogOutputChannel,
	error: AxiosError | unknown,
): void {
	if (isAxiosError(error)) {
		const config = error.config as RequestConfigWithMeta | undefined;
		const meta = config?.metadata;
		const method = (config?.method ?? "GET").toUpperCase();
		const url = config?.url || "";
		const requestId = meta?.requestId ?? "unknown";
		const ms = meta ? Date.now() - meta.startedAt : "?";

		if (error.response) {
			// Response error (4xx, 5xx status codes)
			const msg =
				error.response.statusText || String(error.response.data).slice(0, 100);
			logger.error(
				`← ${shortId(requestId)} ${error.response.status} ${method} ${url} ${ms}ms - ${msg}`,
				error,
			);
		} else {
			// Request error (network, timeout, etc)
			const reason = error.code || error.message || "Network error";
			logger.error(
				`✗ ${shortId(requestId)} ${method} ${url} ${ms}ms - ${reason}`,
				error,
			);
		}
	} else {
		logger.error("Request error", error);
	}
}

export class WsLogger {
	private logger: vscode.LogOutputChannel;
	private url: string;
	private id: string;
	private startedAt: number;
	private openedAt?: number;
	private msgCount = 0;
	private byteCount = 0;

	constructor(logger: vscode.LogOutputChannel, url: string) {
		this.logger = logger;
		this.url = url;
		this.id = crypto.randomUUID().replace(/-/g, "");
		this.startedAt = Date.now();
	}

	logConnecting(): void {
		this.logger.trace(`→ WS ${shortId(this.id)} ${this.url}`);
	}

	logOpen(): void {
		this.openedAt = Date.now();
		const connectMs = this.openedAt - this.startedAt;
		this.logger.trace(`← WS ${shortId(this.id)} connected ${connectMs}ms`);
	}

	logMessage(data: unknown): void {
		this.msgCount += 1;
		this.byteCount += sizeOf(data);
	}

	logClose(code?: number, reason?: string): void {
		const upMs = this.openedAt ? Date.now() - this.openedAt : 0;
		const stats = [];
		if (upMs > 0) {
			stats.push(`${upMs}ms`);
		}
		if (this.msgCount > 0) {
			stats.push(`${this.msgCount} msgs`);
		}
		if (this.byteCount > 0) {
			stats.push(`${this.byteCount}b`);
		}

		const codeStr = code ? ` (${code})` : "";
		const reasonStr = reason ? ` - ${reason}` : "";
		const statsStr = stats.length > 0 ? ` [${stats.join(", ")}]` : "";

		this.logger.trace(
			`✗ WS ${shortId(this.id)} closed${codeStr}${reasonStr}${statsStr}`,
		);
	}

	logError(error: unknown): void {
		const ms = Date.now() - this.startedAt;
		const errorMsg = errToStr(error, "connection error");
		this.logger.error(
			`✗ WS ${shortId(this.id)} error ${ms}ms - ${errorMsg}`,
			error,
		);
	}
}
