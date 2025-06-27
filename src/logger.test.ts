import { describe, it, expect, beforeEach, vi } from "vitest";
import { Logger } from "./logger";

describe("Logger", () => {
	let logger: Logger;
	let mockOutputChannel: {
		appendLine: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		mockOutputChannel = {
			appendLine: vi.fn(),
		};
		logger = new Logger(mockOutputChannel);
	});

	it("should log error messages", () => {
		logger.error("Test error message");
		const logs = logger.getLogs();
		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe("ERROR");
		expect(logs[0].message).toBe("Test error message");
		expect(logs[0].timestamp).toBeInstanceOf(Date);
	});

	it("should log warning messages", () => {
		logger.warn("Test warning message");
		const logs = logger.getLogs();
		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe("WARN");
		expect(logs[0].message).toBe("Test warning message");
	});

	it("should log info messages", () => {
		logger.info("Test info message");
		const logs = logger.getLogs();
		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe("INFO");
		expect(logs[0].message).toBe("Test info message");
	});

	it("should log debug messages", () => {
		logger.debug("Test debug message");
		const logs = logger.getLogs();
		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe("DEBUG");
		expect(logs[0].message).toBe("Test debug message");
	});

	it("should log messages with data", () => {
		const data = { user: "test", action: "login" };
		logger.info("User action", data);
		const logs = logger.getLogs();
		expect(logs).toHaveLength(1);
		expect(logs[0].data).toEqual(data);
	});

	it("should clear logs", () => {
		logger.info("Test message");
		expect(logger.getLogs()).toHaveLength(1);

		logger.clear();
		expect(logger.getLogs()).toHaveLength(0);
	});
});
