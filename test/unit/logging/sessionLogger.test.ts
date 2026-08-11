import { describe, expect, it, vi } from "vitest";

import { SessionLogger } from "@/logging/sessionLogger";

import type * as vscode from "vscode";

function createMockOutputChannel() {
	return {
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		show: vi.fn(),
	} as unknown as vscode.LogOutputChannel & {
		trace: ReturnType<typeof vi.fn>;
		debug: ReturnType<typeof vi.fn>;
		info: ReturnType<typeof vi.fn>;
		warn: ReturnType<typeof vi.fn>;
		error: ReturnType<typeof vi.fn>;
		show: ReturnType<typeof vi.fn>;
	};
}

const SESSION_ID = "0123456789abcdef0123456789abcdef";

describe("SessionLogger", () => {
	it("prefixes every level with the session ID", () => {
		const channel = createMockOutputChannel();
		const logger = new SessionLogger(channel, SESSION_ID);

		logger.trace("trace msg");
		logger.debug("debug msg");
		logger.info("info msg");
		logger.warn("warn msg");
		logger.error("error msg");

		expect(channel.trace).toHaveBeenCalledWith(`[${SESSION_ID}] trace msg`);
		expect(channel.debug).toHaveBeenCalledWith(`[${SESSION_ID}] debug msg`);
		expect(channel.info).toHaveBeenCalledWith(`[${SESSION_ID}] info msg`);
		expect(channel.warn).toHaveBeenCalledWith(`[${SESSION_ID}] warn msg`);
		expect(channel.error).toHaveBeenCalledWith(`[${SESSION_ID}] error msg`);
	});

	it("forwards additional arguments unchanged", () => {
		const channel = createMockOutputChannel();
		const logger = new SessionLogger(channel, SESSION_ID);
		const err = new Error("boom");

		logger.error("failed", err, 42);

		expect(channel.error).toHaveBeenCalledWith(
			`[${SESSION_ID}] failed`,
			err,
			42,
		);
	});

	it("delegates show() to the underlying channel", () => {
		const channel = createMockOutputChannel();
		const logger = new SessionLogger(channel, SESSION_ID);

		logger.show();

		expect(channel.show).toHaveBeenCalledOnce();
	});
});
