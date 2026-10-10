import crypto from "node:crypto";

export function shortId(id: string): string {
	return id.slice(0, 8);
}

export function createRequestId(): string {
	return crypto.randomUUID().replace(/-/g, "");
}
