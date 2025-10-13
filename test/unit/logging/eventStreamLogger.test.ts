import { describe, expect, it } from "vitest";

import { EventStreamLogger } from "@/logging/eventStreamLogger";

import { createMockLogger } from "../../mocks/testHelpers";

describe("EventStreamLogger", () => {
	it("tracks message count and byte size", () => {
		const logger = createMockLogger();
		const eventStreamLogger = new EventStreamLogger(
			logger,
			"wss://example.com",
			"WS",
		);

		eventStreamLogger.logOpen();
		eventStreamLogger.logMessage("hello");
		eventStreamLogger.logMessage("world");
		eventStreamLogger.logMessage(Buffer.from("test"));
		eventStreamLogger.logClose();

		expect(logger.trace).toHaveBeenCalledWith(
			expect.stringContaining("3 msgs"),
		);
		expect(logger.trace).toHaveBeenCalledWith(expect.stringContaining("14 B"));
	});

	it("handles unknown byte sizes with >= indicator", () => {
		const logger = createMockLogger();
		const eventStreamLogger = new EventStreamLogger(
			logger,
			"wss://example.com",
			"WS",
		);

		eventStreamLogger.logOpen();
		eventStreamLogger.logMessage({ complex: "object" }); // Unknown size - no estimation
		eventStreamLogger.logMessage("known");
		eventStreamLogger.logClose();

		expect(logger.trace).toHaveBeenLastCalledWith(
			expect.stringContaining(">= 5 B"),
		);
	});

	it("handles close before open gracefully", () => {
		const logger = createMockLogger();
		const eventStreamLogger = new EventStreamLogger(
			logger,
			"wss://example.com",
			"WS",
		);

		// Closing without opening should not throw
		expect(() => eventStreamLogger.logClose()).not.toThrow();
		expect(logger.trace).toHaveBeenCalled();
	});

	it("formats large message counts with compact notation", () => {
		const logger = createMockLogger();
		const eventStreamLogger = new EventStreamLogger(
			logger,
			"wss://example.com",
			"WS",
		);

		eventStreamLogger.logOpen();
		for (let i = 0; i < 1100; i++) {
			eventStreamLogger.logMessage("x");
		}
		eventStreamLogger.logClose();

		expect(logger.trace).toHaveBeenLastCalledWith(
			expect.stringMatching(/1[.,]1K\s*msgs/),
		);
	});

	it("logs errors with error object", () => {
		const logger = createMockLogger();
		const eventStreamLogger = new EventStreamLogger(
			logger,
			"wss://example.com",
			"WS",
		);
		const error = new Error("Connection failed");

		eventStreamLogger.logError(error, "Failed to connect");

		expect(logger.error).toHaveBeenCalledWith(expect.any(String), error);
	});
});
