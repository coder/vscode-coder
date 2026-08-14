import { describe, expect, it } from "vitest";

import { prefixLogger } from "@/logging/prefixLogger";

import { createMockLogger } from "../../mocks/testHelpers";

const PREFIX = "[0123456789abcdef0123456789abcdef]";

describe("prefixLogger", () => {
	it("prefixes every level with the given prefix", () => {
		const inner = createMockLogger();
		const logger = prefixLogger(inner, PREFIX);

		logger.trace("trace msg");
		logger.debug("debug msg");
		logger.info("info msg");
		logger.warn("warn msg");
		logger.error("error msg");

		expect(inner.trace).toHaveBeenCalledWith(`${PREFIX} trace msg`);
		expect(inner.debug).toHaveBeenCalledWith(`${PREFIX} debug msg`);
		expect(inner.info).toHaveBeenCalledWith(`${PREFIX} info msg`);
		expect(inner.warn).toHaveBeenCalledWith(`${PREFIX} warn msg`);
		expect(inner.error).toHaveBeenCalledWith(`${PREFIX} error msg`);
	});

	it("forwards additional arguments unchanged", () => {
		const inner = createMockLogger();
		const logger = prefixLogger(inner, PREFIX);
		const err = new Error("boom");

		logger.error("failed", err, 42);

		expect(inner.error).toHaveBeenCalledWith(`${PREFIX} failed`, err, 42);
	});

	it("delegates show() to the underlying logger", () => {
		const inner = createMockLogger();
		const logger = prefixLogger(inner, PREFIX);

		logger.show();

		expect(inner.show).toHaveBeenCalledOnce();
	});
});
