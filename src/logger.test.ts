import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock vscode module before importing logger
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue(false),
		}),
		onDidChangeConfiguration: vi.fn().mockReturnValue({
			dispose: vi.fn(),
		}),
	},
	Disposable: class {
		dispose = vi.fn();
	},
}));

import * as vscode from "vscode";
import { ArrayAdapter, LogLevel, NoOpAdapter, logger } from "./logger";
import { OutputChannelAdapter } from "./logging";
import { TestConfigProvider } from "./test";

describe("Logger", () => {
	beforeEach(() => {
		process.env.NODE_ENV = "test";
		logger.reset();
	});

	afterEach(() => {
		logger.reset();
		vi.clearAllMocks();
	});

	describe("ArrayAdapter", () => {
		it("should store messages in array", () => {
			const adapter = new ArrayAdapter();
			adapter.write("test message 1");
			adapter.write("test message 2");

			const snapshot = adapter.getSnapshot();
			expect(snapshot).toEqual(["test message 1", "test message 2"]);
		});

		it("should clear messages", () => {
			const adapter = new ArrayAdapter();
			adapter.write("test message");
			adapter.clear();

			const snapshot = adapter.getSnapshot();
			expect(snapshot).toEqual([]);
		});

		it("should return immutable snapshot", () => {
			const adapter = new ArrayAdapter();
			adapter.write("test message");

			const snapshot1 = adapter.getSnapshot();
			const snapshot2 = adapter.getSnapshot();

			expect(snapshot1).not.toBe(snapshot2);
			expect(snapshot1).toEqual(snapshot2);
		});
	});

	describe("OutputChannelAdapter", () => {
		it("should write to output channel", () => {
			const mockChannel = {
				appendLine: vi.fn(),
				clear: vi.fn(),
			} as unknown as vscode.OutputChannel;

			const adapter = new OutputChannelAdapter(mockChannel);
			adapter.write("test message");

			expect(mockChannel.appendLine).toHaveBeenCalledWith("test message");
		});

		it("should clear output channel", () => {
			const mockChannel = {
				appendLine: vi.fn(),
				clear: vi.fn(),
			} as unknown as vscode.OutputChannel;

			const adapter = new OutputChannelAdapter(mockChannel);
			adapter.clear();

			expect(mockChannel.clear).toHaveBeenCalled();
		});

		it("should not throw if output channel is disposed", () => {
			const mockChannel = {
				appendLine: vi.fn().mockImplementation(() => {
					throw new Error("Channel disposed");
				}),
				clear: vi.fn().mockImplementation(() => {
					throw new Error("Channel disposed");
				}),
			} as unknown as vscode.OutputChannel;

			const adapter = new OutputChannelAdapter(mockChannel);

			expect(() => adapter.write("test")).not.toThrow();
			expect(() => adapter.clear()).not.toThrow();
		});
	});

	describe("NoOpAdapter", () => {
		it("should do nothing", () => {
			const adapter = new NoOpAdapter();
			expect(() => adapter.write("test")).not.toThrow();
			expect(() => adapter.clear()).not.toThrow();
		});
	});

	describe("Logger core functionality", () => {
		it("should format info messages correctly", () => {
			const adapter = new ArrayAdapter();
			logger.setAdapter(adapter);

			const beforeTime = new Date().toISOString();
			logger.info("Test info message");
			const afterTime = new Date().toISOString();

			const logs = adapter.getSnapshot();
			expect(logs).toHaveLength(1);

			const logMatch = logs[0].match(/\[info\] (\S+) Test info message/);
			expect(logMatch).toBeTruthy();

			const timestamp = logMatch![1];
			expect(timestamp >= beforeTime).toBe(true);
			expect(timestamp <= afterTime).toBe(true);
		});

		it("should format debug messages correctly", () => {
			const adapter = new ArrayAdapter();
			logger.setAdapter(adapter);
			logger.setLevel(LogLevel.DEBUG);

			logger.debug("Test debug message");

			const logs = adapter.getSnapshot();
			expect(logs).toHaveLength(1);
			expect(logs[0]).toMatch(/\[debug\] \S+ Test debug message/);
		});

		it("should include source location in debug messages when verbose", () => {
			const adapter = new ArrayAdapter();
			logger.setAdapter(adapter);
			logger.setLevel(LogLevel.DEBUG);

			logger.debug("Test debug with location");

			const logs = adapter.getSnapshot();
			expect(logs).toHaveLength(1);
			expect(logs[0]).toContain("[debug]");
			expect(logs[0]).toContain("Test debug with location");
			// Should contain source location - may be in either format
			expect(logs[0]).toMatch(/\n\s+at .+:\d+|\n\s+at .+ \(.+:\d+\)/);
		});

		it("should respect log levels", () => {
			const adapter = new ArrayAdapter();
			logger.setAdapter(adapter);
			logger.setLevel(LogLevel.INFO);

			logger.debug("Debug message");
			logger.info("Info message");

			const logs = adapter.getSnapshot();
			expect(logs).toHaveLength(1);
			expect(logs[0]).toContain("Info message");
		});

		it("should handle NONE log level", () => {
			const adapter = new ArrayAdapter();
			logger.setAdapter(adapter);
			logger.setLevel(LogLevel.NONE);

			logger.debug("Debug message");
			logger.info("Info message");

			const logs = adapter.getSnapshot();
			expect(logs).toHaveLength(0);
		});
	});

	describe("Configuration", () => {
		it("should read verbose setting on initialization", () => {
			const adapter = new ArrayAdapter();
			const configProvider = new TestConfigProvider();

			logger.setAdapter(adapter);
			logger.setConfigProvider(configProvider);

			// Test with verbose = false
			configProvider.setVerbose(false);
			logger.debug("Debug message");
			logger.info("Info message");

			let logs = adapter.getSnapshot();
			expect(logs.length).toBe(1); // Only info should be logged
			expect(logs[0]).toContain("Info message");

			// Clear and test with verbose = true
			adapter.clear();
			configProvider.setVerbose(true);
			logger.debug("Debug message 2");
			logger.info("Info message 2");

			logs = adapter.getSnapshot();
			expect(logs.length).toBe(2); // Both should be logged
			expect(logs[0]).toContain("Debug message 2");
			expect(logs[1]).toContain("Info message 2");
		});

		it("should update log level when configuration changes", () => {
			const adapter = new ArrayAdapter();
			const configProvider = new TestConfigProvider();

			logger.setAdapter(adapter);
			logger.setConfigProvider(configProvider);

			// Start with verbose = false
			configProvider.setVerbose(false);
			logger.debug("Debug 1");
			logger.info("Info 1");

			let logs = adapter.getSnapshot();
			expect(logs.length).toBe(1); // Only info

			// Change to verbose = true
			adapter.clear();
			configProvider.setVerbose(true);
			logger.debug("Debug 2");
			logger.info("Info 2");

			logs = adapter.getSnapshot();
			expect(logs.length).toBe(2); // Both logged
		});
	});

	describe("Adapter management", () => {
		it("should throw when setAdapter called in non-test environment", () => {
			const originalEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = "production";
			try {
				expect(() => logger.setAdapter(new ArrayAdapter())).toThrow(
					"setAdapter can only be called in test environment",
				);
			} finally {
				process.env.NODE_ENV = originalEnv;
			}
		});

		it("should throw when reset called in non-test environment", () => {
			const originalEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = "production";
			try {
				expect(() => logger.reset()).toThrow(
					"reset can only be called in test environment",
				);
			} finally {
				process.env.NODE_ENV = originalEnv;
			}
		});

		it("should throw when adapter already set", () => {
			logger.setAdapter(new ArrayAdapter());
			expect(() => logger.setAdapter(new ArrayAdapter())).toThrow(
				"Adapter already set. Use reset() first or withAdapter() for temporary changes",
			);
		});

		it("should allow temporary adapter changes with withAdapter", () => {
			const adapter1 = new ArrayAdapter();
			const adapter2 = new ArrayAdapter();

			logger.setAdapter(adapter1);
			logger.info("Message 1");

			const result = logger.withAdapter(adapter2, () => {
				logger.info("Message 2");
				return "test result";
			});

			logger.info("Message 3");

			expect(result).toBe("test result");
			expect(adapter1.getSnapshot()).toEqual(
				expect.arrayContaining([
					expect.stringContaining("Message 1"),
					expect.stringContaining("Message 3"),
				]),
			);
			expect(adapter2.getSnapshot()).toEqual(
				expect.arrayContaining([expect.stringContaining("Message 2")]),
			);
		});

		it("should restore adapter even if function throws", () => {
			const adapter1 = new ArrayAdapter();
			const adapter2 = new ArrayAdapter();

			logger.setAdapter(adapter1);

			expect(() =>
				logger.withAdapter(adapter2, () => {
					throw new Error("Test error");
				}),
			).toThrow("Test error");

			logger.info("After error");
			expect(adapter1.getSnapshot()).toEqual(
				expect.arrayContaining([expect.stringContaining("After error")]),
			);
			expect(adapter2.getSnapshot()).toHaveLength(0);
		});

		it("should dispose configuration listener on reset", () => {
			const adapter = new ArrayAdapter();
			const configProvider = new TestConfigProvider();

			logger.setAdapter(adapter);
			logger.setConfigProvider(configProvider);

			// Track if dispose was called
			let disposed = false;
			const originalOnVerboseChange =
				configProvider.onVerboseChange.bind(configProvider);
			configProvider.onVerboseChange = (callback: () => void) => {
				const result = originalOnVerboseChange(callback);
				return {
					dispose: () => {
						disposed = true;
						result.dispose();
					},
				};
			};

			// Re-set config provider to register the wrapped listener
			logger.setConfigProvider(configProvider);

			// Reset should dispose the listener
			logger.reset();

			expect(disposed).toBe(true);
		});
	});

	describe("Initialize", () => {
		it("should initialize with OutputChannel", () => {
			const mockChannel = {
				appendLine: vi.fn(),
				clear: vi.fn(),
			} as unknown as vscode.OutputChannel;

			const adapter = new OutputChannelAdapter(mockChannel);
			logger.initialize(adapter);

			// Set up config provider for test
			const configProvider = new TestConfigProvider();
			logger.setConfigProvider(configProvider);

			// Verify we can log after initialization
			logger.info("Test message");
			expect(mockChannel.appendLine).toHaveBeenCalled();
		});

		it("should throw if already initialized", () => {
			const mockChannel = {} as vscode.OutputChannel;
			const adapter = new OutputChannelAdapter(mockChannel);
			logger.initialize(adapter);

			expect(() => logger.initialize(adapter)).toThrow(
				"Logger already initialized",
			);
		});
	});

	describe("Performance", () => {
		it("should have minimal overhead for disabled debug calls", () => {
			const noOpAdapter = new NoOpAdapter();
			const arrayAdapter = new ArrayAdapter();

			// Measure NoOp baseline
			logger.setAdapter(noOpAdapter);
			logger.setLevel(LogLevel.INFO); // Debug disabled

			const noOpStart = performance.now();
			for (let i = 0; i < 10000; i++) {
				logger.debug(`Debug message ${i}`);
			}
			const noOpTime = performance.now() - noOpStart;

			// Measure with ArrayAdapter
			logger.reset();
			logger.setAdapter(arrayAdapter);
			logger.setLevel(LogLevel.INFO); // Debug disabled

			const arrayStart = performance.now();
			for (let i = 0; i < 10000; i++) {
				logger.debug(`Debug message ${i}`);
			}
			const arrayTime = performance.now() - arrayStart;

			// Should have less than 10% overhead when disabled
			const overhead = (arrayTime - noOpTime) / noOpTime;
			expect(overhead).toBeLessThan(0.1);
			expect(arrayAdapter.getSnapshot()).toHaveLength(0); // No messages logged
		});

		it("should have acceptable overhead for enabled debug calls", () => {
			const noOpAdapter = new NoOpAdapter();
			const arrayAdapter = new ArrayAdapter();

			// Measure NoOp baseline
			logger.setAdapter(noOpAdapter);
			logger.setLevel(LogLevel.DEBUG); // Debug enabled

			const noOpStart = performance.now();
			for (let i = 0; i < 1000; i++) {
				logger.debug(`Debug message ${i}`);
			}
			const noOpTime = performance.now() - noOpStart;

			// Measure with ArrayAdapter
			logger.reset();
			logger.setAdapter(arrayAdapter);
			logger.setLevel(LogLevel.DEBUG); // Debug enabled

			const arrayStart = performance.now();
			for (let i = 0; i < 1000; i++) {
				logger.debug(`Debug message ${i}`);
			}
			const arrayTime = performance.now() - arrayStart;

			// Should have less than 10x overhead when enabled
			const overhead = arrayTime / noOpTime;
			expect(overhead).toBeLessThan(10);
			expect(arrayAdapter.getSnapshot()).toHaveLength(1000); // All messages logged
		});

		it("should have acceptable overhead for info calls", () => {
			const noOpAdapter = new NoOpAdapter();
			const arrayAdapter = new ArrayAdapter();

			// Measure NoOp baseline
			logger.setAdapter(noOpAdapter);

			const noOpStart = performance.now();
			for (let i = 0; i < 1000; i++) {
				logger.info(`Info message ${i}`);
			}
			const noOpTime = performance.now() - noOpStart;

			// Measure with ArrayAdapter
			logger.reset();
			logger.setAdapter(arrayAdapter);

			const arrayStart = performance.now();
			for (let i = 0; i < 1000; i++) {
				logger.info(`Info message ${i}`);
			}
			const arrayTime = performance.now() - arrayStart;

			// Should have less than 5x overhead for info
			const overhead = arrayTime / noOpTime;
			expect(overhead).toBeLessThan(5);
			expect(arrayAdapter.getSnapshot()).toHaveLength(1000); // All messages logged
		});
	});
});
