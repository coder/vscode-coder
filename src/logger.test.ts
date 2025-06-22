import { describe, it, expect, beforeEach, vi } from "vitest";
import { Logger, LoggerService } from "./logger";
import { createMockOutputChannelWithLogger } from "./test-helpers";

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

	it("should maintain log order", () => {
		logger.info("First");
		logger.warn("Second");
		logger.error("Third");
		logger.debug("Fourth");

		const logs = logger.getLogs();
		expect(logs).toHaveLength(4);
		expect(logs[0].message).toBe("First");
		expect(logs[1].message).toBe("Second");
		expect(logs[2].message).toBe("Third");
		expect(logs[3].message).toBe("Fourth");
	});

	it("should clear logs", () => {
		logger.info("Test message");
		expect(logger.getLogs()).toHaveLength(1);

		logger.clear();
		expect(logger.getLogs()).toHaveLength(0);
	});

	it("should handle undefined data", () => {
		logger.info("Message without data");
		const logs = logger.getLogs();
		expect(logs[0].data).toBeUndefined();
	});
});

describe("Logger with OutputChannel", () => {
	it("should write logs to output channel when provided", () => {
		const { mockOutputChannel, logger } = createMockOutputChannelWithLogger();
		logger.info("Test message");

		expect(mockOutputChannel.appendLine).toHaveBeenCalledOnce();
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining("[INFO] Test message"),
		);
	});

	it("should implement writeToCoderOutputChannel for backward compatibility", () => {
		const { mockOutputChannel, logger } = createMockOutputChannelWithLogger();

		logger.writeToCoderOutputChannel("Test message");

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringMatching(/\[.*\] \[INFO\] Test message/),
		);
	});

	it("should log writeToCoderOutputChannel messages as INFO level", () => {
		const logger = new Logger();

		logger.writeToCoderOutputChannel("Backward compatible message");

		const logs = logger.getLogs();
		expect(logs).toHaveLength(1);
		expect(logs[0].level).toBe("INFO");
		expect(logs[0].message).toBe("Backward compatible message");
	});

	it("should handle error-like messages appropriately", () => {
		const { mockOutputChannel, logger } = createMockOutputChannelWithLogger();

		logger.writeToCoderOutputChannel("Error: Something went wrong");

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringMatching(/\[.*\] \[INFO\] Error: Something went wrong/),
		);
	});
});

describe("Logger with log level filtering", () => {
	it("should filter debug logs when verbose is false", () => {
		const { mockOutputChannel, logger } = createMockOutputChannelWithLogger({
			verbose: false,
		});
		logger.debug("Debug message");
		logger.info("Info message");
		logger.warn("Warn message");
		logger.error("Error message");

		expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(3);
		expect(mockOutputChannel.appendLine).not.toHaveBeenCalledWith(
			expect.stringContaining("[DEBUG]"),
		);
	});

	it("should include debug logs when verbose is true", () => {
		const { mockOutputChannel, logger: verboseLogger } =
			createMockOutputChannelWithLogger({ verbose: true });
		verboseLogger.debug("Debug message");
		verboseLogger.info("Info message");

		expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(2);
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining("[DEBUG] Debug message"),
		);
	});

	it("should include data in output when provided", () => {
		const { mockOutputChannel, logger } = createMockOutputChannelWithLogger();
		const data = { userId: 123, action: "login" };
		logger.info("User action", data);

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining('{"userId":123,"action":"login"}'),
		);
	});
});

describe("LoggerService", () => {
	it("should create logger with VS Code configuration", () => {
		const mockOutputChannel = {
			appendLine: vi.fn(),
		};
		const mockWorkspace = {
			getConfiguration: vi.fn().mockReturnValue({
				get: vi.fn().mockReturnValue(true), // coder.verbose = true
			}),
		};

		const loggerService = new LoggerService(mockOutputChannel, mockWorkspace);
		const logger = loggerService.createLogger();

		logger.debug("Debug message");
		logger.info("Info message");

		// Both messages should be logged since verbose is true
		expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(2);
		expect(mockWorkspace.getConfiguration).toHaveBeenCalledWith("coder");
	});
});
