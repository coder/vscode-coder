import prettyBytes from "pretty-bytes";

import { errToStr } from "../api/api-helper";

import { formatTime } from "./formatters";
import { createRequestId, shortId, sizeOf } from "./utils";

import type { Logger } from "./logger";

const numFormatter = new Intl.NumberFormat("en", {
	notation: "compact",
	compactDisplay: "short",
});

export class EventStreamLogger {
	private readonly logger: Logger;
	private readonly url: string;
	private readonly id: string;
	private readonly protocol: string;
	private readonly startedAt: number;
	private openedAt?: number;
	private msgCount = 0;
	private byteCount = 0;
	private unknownByteCount = false;

	constructor(logger: Logger, url: string, protocol: "WS" | "SSE") {
		this.logger = logger;
		this.url = url;
		this.protocol = protocol;
		this.id = createRequestId();
		this.startedAt = Date.now();
	}

	logConnecting(): void {
		this.logger.trace(`→ ${this.protocol} ${shortId(this.id)} ${this.url}`);
	}

	logOpen(): void {
		this.openedAt = Date.now();
		const time = formatTime(this.openedAt - this.startedAt);
		this.logger.trace(
			`← ${this.protocol} ${shortId(this.id)} connected ${this.url} ${time}`,
		);
	}

	logMessage(data: unknown): void {
		this.msgCount += 1;
		const potentialSize = sizeOf(data);
		if (potentialSize === undefined) {
			this.unknownByteCount = true;
		} else {
			this.byteCount += potentialSize;
		}
	}

	logClose(code?: number, reason?: string): void {
		const upMs = this.openedAt ? Date.now() - this.openedAt : 0;
		const stats = [
			formatTime(upMs),
			`${numFormatter.format(this.msgCount)} msgs`,
			this.formatBytes(),
		];

		const codeStr = code ? ` (${code})` : "";
		const reasonStr = reason ? ` - ${reason}` : "";
		const statsStr = ` [${stats.join(", ")}]`;

		this.logger.trace(
			`▣ ${this.protocol} ${shortId(this.id)} closed ${this.url}${codeStr}${reasonStr}${statsStr}`,
		);
	}

	logError(error: unknown, message: string): void {
		const time = formatTime(Date.now() - this.startedAt);
		const errorMsg = message || errToStr(error, "connection error");
		this.logger.error(
			`✗ ${this.protocol} ${shortId(this.id)} error ${this.url} ${time} - ${errorMsg}`,
			error,
		);
	}

	private formatBytes(): string {
		const bytes = prettyBytes(this.byteCount);
		return this.unknownByteCount ? `>= ${bytes}` : bytes;
	}
}
