import { Buffer } from "node:buffer";
import crypto from "node:crypto";

export function shortId(id: string): string {
	return id.slice(0, 8);
}

export function formatTime(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	if (ms < 60000) {
		return `${(ms / 1000).toFixed(2)}s`;
	}
	if (ms < 3600000) {
		return `${(ms / 60000).toFixed(2)}m`;
	}
	return `${(ms / 3600000).toFixed(2)}h`;
}

export function sizeOf(data: unknown): number | undefined {
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
	return undefined;
}

export function createRequestId(): string {
	return crypto.randomUUID().replace(/-/g, "");
}
