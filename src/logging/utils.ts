import { Buffer } from "node:buffer";
import crypto from "node:crypto";

export function shortId(id: string): string {
	return id.slice(0, 8);
}

export function sizeOf(data: unknown): number | undefined {
	if (data === null || data === undefined) {
		return 0;
	}
	if (typeof data === "number" || typeof data === "boolean") {
		return 8;
	}
	if (typeof data === "string" || typeof data === "bigint") {
		return Buffer.byteLength(data.toString());
	}
	if (
		Buffer.isBuffer(data) ||
		data instanceof ArrayBuffer ||
		ArrayBuffer.isView(data)
	) {
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
