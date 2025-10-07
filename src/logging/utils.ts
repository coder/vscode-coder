import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import util from "node:util";

export function shortId(id: string): string {
	return id.slice(0, 8);
}

export function createRequestId(): string {
	return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Returns the byte size of the data if it can be determined from the data's intrinsic properties,
 * otherwise returns undefined (e.g., for plain objects and arrays that would require serialization).
 */
export function sizeOf(data: unknown): number | undefined {
	if (data === null || data === undefined) {
		return 0;
	}
	if (typeof data === "boolean") {
		return 4;
	}
	if (typeof data === "number") {
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

export function safeStringify(data: unknown): string | null {
	try {
		return util.inspect(data, {
			showHidden: false,
			depth: Infinity,
			maxArrayLength: Infinity,
			maxStringLength: Infinity,
			breakLength: Infinity,
			compact: true,
			getters: false, // avoid side-effects
		});
	} catch {
		// Should rarely happen but just in case
		return null;
	}
}
