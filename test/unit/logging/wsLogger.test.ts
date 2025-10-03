import { describe, expect, it } from "vitest";

import { WsLogger } from "@/logging/wsLogger";

import { createMockLogger } from "../../mocks/testHelpers";

describe("WS Logger", () => {
	it("tracks message count and byte size", () => {
		const logger = createMockLogger();
		const wsLogger = new WsLogger(logger, "wss://example.com");

		wsLogger.logOpen();
		wsLogger.logMessage("hello");
		wsLogger.logMessage("world");
		wsLogger.logMessage(Buffer.from("test"));
		wsLogger.logClose();

		expect(logger.trace).toHaveBeenCalledWith(
			expect.stringContaining("3 msgs"),
		);
		expect(logger.trace).toHaveBeenCalledWith(expect.stringContaining("14 B"));
	});

	it("handles unknown byte sizes with >= indicator", () => {
		const logger = createMockLogger();
		const wsLogger = new WsLogger(logger, "wss://example.com");

		wsLogger.logOpen();
		wsLogger.logMessage({ complex: "object" }); // Unknown size - no estimation
		wsLogger.logMessage("known");
		wsLogger.logClose();

		expect(logger.trace).toHaveBeenLastCalledWith(
			expect.stringContaining(">= 5 B"),
		);
	});

	it("handles close before open gracefully", () => {
		const logger = createMockLogger();
		const wsLogger = new WsLogger(logger, "wss://example.com");

		// Closing without opening should not throw
		expect(() => wsLogger.logClose()).not.toThrow();
		expect(logger.trace).toHaveBeenCalled();
	});

	it("formats large message counts with compact notation", () => {
		const logger = createMockLogger();
		const wsLogger = new WsLogger(logger, "wss://example.com");

		wsLogger.logOpen();
		for (let i = 0; i < 1100; i++) {
			wsLogger.logMessage("x");
		}
		wsLogger.logClose();

		expect(logger.trace).toHaveBeenLastCalledWith(
			expect.stringMatching(/1[.,]1K\s*msgs/),
		);
	});

	it("logs errors with error object", () => {
		const logger = createMockLogger();
		const wsLogger = new WsLogger(logger, "wss://example.com");
		const error = new Error("Connection failed");

		wsLogger.logError(error, "Failed to connect");

		expect(logger.error).toHaveBeenCalledWith(expect.any(String), error);
	});
});
