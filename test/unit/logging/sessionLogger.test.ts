import { describe, expect, it } from "vitest";

import { SessionLogger } from "@/logging/sessionLogger";

import { createMockLogger } from "../../mocks/testHelpers";

const SESSION_ID = "0123456789abcdef0123456789abcdef";

describe("SessionLogger", () => {
	it("prefixes every level with the session ID", () => {
		const inner = createMockLogger();
		const logger = new SessionLogger(inner, SESSION_ID);

		logger.trace("trace msg");
		logger.debug("debug msg");
		logger.info("info msg");
		logger.warn("warn msg");
		logger.error("error msg");

		expect(inner.trace).toHaveBeenCalledWith(`[${SESSION_ID}] trace msg`);
		expect(inner.debug).toHaveBeenCalledWith(`[${SESSION_ID}] debug msg`);
		expect(inner.info).toHaveBeenCalledWith(`[${SESSION_ID}] info msg`);
		expect(inner.warn).toHaveBeenCalledWith(`[${SESSION_ID}] warn msg`);
		expect(inner.error).toHaveBeenCalledWith(`[${SESSION_ID}] error msg`);
	});

	it("forwards additional arguments unchanged", () => {
		const inner = createMockLogger();
		const logger = new SessionLogger(inner, SESSION_ID);
		const err = new Error("boom");

		logger.error("failed", err, 42);

		expect(inner.error).toHaveBeenCalledWith(`[${SESSION_ID}] failed`, err, 42);
	});

	it("delegates show() to the underlying logger", () => {
		const inner = createMockLogger();
		const logger = new SessionLogger(inner, SESSION_ID);

		logger.show();

		expect(inner.show).toHaveBeenCalledOnce();
	});
});
