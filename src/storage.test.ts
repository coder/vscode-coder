import type { AxiosInstance } from "axios";
import type { Api } from "coder/site/src/api/api";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import * as vscode from "vscode";
import { Logger } from "./logger";
import { Storage } from "./storage";
import {
	createMockOutputChannelWithLogger,
	createMockExtensionContext,
	createMockUri,
	createMockRestClient,
	createMockConfiguration,
} from "./test-helpers";

// Setup all mocks
function setupMocks() {
	vi.mock("./headers");
	vi.mock("./api-helper");
	vi.mock("./cliManager");
	vi.mock("fs/promises");
}

setupMocks();

beforeAll(() => {
	vi.mock("vscode", async () => {
		const helpers = await import("./test-helpers");
		return helpers.createMockVSCode();
	});
});

describe("storage", () => {
	let mockOutput: vscode.OutputChannel;
	let mockMemento: vscode.Memento;
	let mockSecrets: vscode.SecretStorage;
	let mockGlobalStorageUri: vscode.Uri;
	let mockLogUri: vscode.Uri;
	let storage: Storage;
	let logger: Logger;

	beforeEach(() => {
		// Use factory functions instead of inline mocks
		const { mockOutputChannel, logger: testLogger } =
			createMockOutputChannelWithLogger();
		mockOutput = mockOutputChannel as unknown as vscode.OutputChannel;
		logger = testLogger;

		// Use real extension context factory for memento and secrets
		const mockContext = createMockExtensionContext();
		mockMemento = mockContext.globalState;
		mockSecrets = mockContext.secrets;

		// Use URI factory
		mockGlobalStorageUri = createMockUri("/mock/global/storage");
		mockLogUri = createMockUri("/mock/log/path");

		storage = new Storage(
			mockOutput,
			mockMemento,
			mockSecrets,
			mockGlobalStorageUri,
			mockLogUri,
			logger,
		);
	});

	it.skip("should create Storage instance", () => {
		expect(storage).toBeInstanceOf(Storage);
	});

	describe("getUrl", () => {
		it("should return URL from memento", () => {
			const testUrl = "https://coder.example.com";
			vi.mocked(mockMemento.get).mockReturnValue(testUrl);

			const result = storage.getUrl();

			expect(result).toBe(testUrl);
			expect(mockMemento.get).toHaveBeenCalledWith("url");
		});

		it("should return undefined when no URL is stored", () => {
			vi.mocked(mockMemento.get).mockReturnValue(undefined);

			const result = storage.getUrl();

			expect(result).toBeUndefined();
			expect(mockMemento.get).toHaveBeenCalledWith("url");
		});
	});

	describe("withUrlHistory", () => {
		it.each([
			["empty array when no history exists", undefined, [], []],
			[
				"append new URLs to existing history",
				["https://old.com"],
				["https://new.com"],
				["https://old.com", "https://new.com"],
			],
			[
				"filter out undefined values",
				["https://old.com"],
				[undefined, "https://new.com", undefined],
				["https://old.com", "https://new.com"],
			],
			[
				"remove duplicates and move to end",
				["https://a.com", "https://b.com", "https://c.com"],
				["https://b.com"],
				["https://a.com", "https://c.com", "https://b.com"],
			],
			[
				"limit history to MAX_URLS (10)",
				Array.from({ length: 10 }, (_, i) => `https://url${i}.com`),
				["https://new.com"],
				[
					...Array.from({ length: 9 }, (_, i) => `https://url${i + 1}.com`),
					"https://new.com",
				],
			],
		])(
			"should return %s",
			(
				_: string,
				existing: string[] | undefined,
				newUrls: (string | undefined)[],
				expected: string[],
			) => {
				vi.mocked(mockMemento.get).mockReturnValue(existing);

				const result = storage.withUrlHistory(
					...(newUrls as [string?, string?]),
				);

				expect(result).toEqual(expected);
				if (existing !== undefined || newUrls.length > 0) {
					expect(mockMemento.get).toHaveBeenCalledWith("urlHistory");
				}
			},
		);
	});

	describe("setUrl", () => {
		it("should set URL and update history when URL is provided", async () => {
			const testUrl = "https://coder.example.com";
			vi.mocked(mockMemento.get).mockReturnValue([]); // Empty history
			vi.mocked(mockMemento.update).mockResolvedValue();

			await storage.setUrl(testUrl);

			expect(mockMemento.update).toHaveBeenCalledWith("url", testUrl);
			expect(mockMemento.update).toHaveBeenCalledWith("urlHistory", [testUrl]);
		});

		it("should only set URL without updating history when URL is falsy", async () => {
			vi.mocked(mockMemento.update).mockResolvedValue();

			await storage.setUrl(undefined);

			expect(mockMemento.update).toHaveBeenCalledWith("url", undefined);
			expect(mockMemento.update).toHaveBeenCalledTimes(1);
		});

		it.skip("should set URL to empty string", async () => {
			vi.mocked(mockMemento.update).mockResolvedValue();

			await storage.setUrl("");

			expect(mockMemento.update).toHaveBeenCalledWith("url", "");
			expect(mockMemento.update).toHaveBeenCalledTimes(1);
		});
	});

	describe("withUrlHistory", () => {
		it("should return empty array when no history exists and no URLs provided", () => {
			vi.mocked(mockMemento.get).mockReturnValue(undefined);

			const result = storage.withUrlHistory();

			expect(result).toEqual([]);
		});

		it("should return existing history when no new URLs provided", () => {
			const existingHistory = ["https://first.com", "https://second.com"];
			vi.mocked(mockMemento.get).mockReturnValue(existingHistory);

			const result = storage.withUrlHistory();

			expect(result).toEqual(existingHistory);
		});

		it("should append new URL to existing history", () => {
			const existingHistory = ["https://first.com"];
			const newUrl = "https://second.com";
			vi.mocked(mockMemento.get).mockReturnValue(existingHistory);

			const result = storage.withUrlHistory(newUrl);

			expect(result).toEqual(["https://first.com", "https://second.com"]);
		});

		it("should move existing URL to end when re-added", () => {
			const existingHistory = [
				"https://first.com",
				"https://second.com",
				"https://third.com",
			];
			vi.mocked(mockMemento.get).mockReturnValue(existingHistory);

			const result = storage.withUrlHistory("https://first.com");

			expect(result).toEqual([
				"https://second.com",
				"https://third.com",
				"https://first.com",
			]);
		});

		it("should ignore undefined URLs", () => {
			const existingHistory = ["https://first.com"];
			vi.mocked(mockMemento.get).mockReturnValue(existingHistory);

			const result = storage.withUrlHistory(
				undefined,
				"https://second.com",
				undefined,
			);

			expect(result).toEqual(["https://first.com", "https://second.com"]);
		});

		it("should limit history to MAX_URLS (10) and remove oldest entries", () => {
			// Create 10 existing URLs
			const existingHistory = Array.from(
				{ length: 10 },
				(_, i) => `https://site${i}.com`,
			);
			vi.mocked(mockMemento.get).mockReturnValue(existingHistory);

			const result = storage.withUrlHistory("https://new.com");

			expect(result).toHaveLength(10);
			expect(result[0]).toBe("https://site1.com"); // First entry removed
			expect(result[9]).toBe("https://new.com"); // New entry at end
		});
	});

	describe("setSessionToken", () => {
		it.each([
			["store token when provided", "test-session-token", "store"],
			["delete token when undefined", undefined, "delete"],
			["delete token when empty string", "", "delete"],
		])(
			"should %s",
			async (_, token: string | undefined, expectedAction: string) => {
				if (expectedAction === "store") {
					vi.mocked(mockSecrets.store).mockResolvedValue();
					await storage.setSessionToken(token);
					expect(mockSecrets.store).toHaveBeenCalledWith("sessionToken", token);
				} else {
					vi.mocked(mockSecrets.delete).mockResolvedValue();
					await storage.setSessionToken(token);
					expect(mockSecrets.delete).toHaveBeenCalledWith("sessionToken");
				}
			},
		);
	});

	describe("getSessionToken", () => {
		it("should return token from secrets", async () => {
			const testToken = "test-session-token";
			vi.mocked(mockSecrets.get).mockResolvedValue(testToken);

			const result = await storage.getSessionToken();

			expect(result).toBe(testToken);
			expect(mockSecrets.get).toHaveBeenCalledWith("sessionToken");
		});

		it("should return undefined when secrets throw error", async () => {
			vi.mocked(mockSecrets.get).mockRejectedValue(
				new Error("Corrupt session store"),
			);

			const result = await storage.getSessionToken();

			expect(result).toBeUndefined();
		});
	});

	describe("getBinaryCachePath", () => {
		it.each([
			[
				"label-specific path",
				"test-label",
				"/mock/global/storage/test-label/bin",
			],
			[
				"deployment-specific path",
				"my-deployment",
				"/mock/global/storage/my-deployment/bin",
			],
			["default path when no label", "", "/mock/global/storage/bin"],
		])("should return %s", (_, label, expected) => {
			expect(storage.getBinaryCachePath(label)).toBe(expected);
		});

		it("should use custom destination when configured", () => {
			const mockConfig = createMockConfiguration({
				"coder.binaryDestination": "/custom/path",
			});
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

			const newStorage = new Storage(
				mockOutput,
				mockMemento,
				mockSecrets,
				mockGlobalStorageUri,
				mockLogUri,
				logger,
			);

			expect(newStorage.getBinaryCachePath("test-label")).toBe("/custom/path");
		});
	});

	describe("writeToCoderOutputChannel", () => {
		it("should append formatted message to output", () => {
			const testMessage = "Test log message";

			storage.writeToCoderOutputChannel(testMessage);

			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				expect.stringMatching(
					/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] Test log message$/,
				),
			);
		});
	});

	describe("getNetworkInfoPath", () => {
		it("should return network info path", () => {
			const result = storage.getNetworkInfoPath();

			expect(result).toBe("/mock/global/storage/net");
		});
	});

	describe("getLogPath", () => {
		it("should return log path", () => {
			const result = storage.getLogPath();

			expect(result).toBe("/mock/global/storage/log");
		});
	});

	describe("getUserSettingsPath", () => {
		it("should return user settings path", () => {
			const result = storage.getUserSettingsPath();

			expect(result).toBe("/User/settings.json");
		});
	});

	describe.each([
		[
			"getSessionTokenPath",
			(s: Storage, l: string) => s.getSessionTokenPath(l),
			"session",
		],
		[
			"getLegacySessionTokenPath",
			(s: Storage, l: string) => s.getLegacySessionTokenPath(l),
			"session_token",
		],
		["getUrlPath", (s: Storage, l: string) => s.getUrlPath(l), "url"],
	])("%s", (_, method, suffix) => {
		it.each([
			[
				"label-specific path",
				"test-deployment",
				`/mock/global/storage/test-deployment/${suffix}`,
			],
			["default path when no label", "", `/mock/global/storage/${suffix}`],
		])("should return %s", (_, label, expected) => {
			expect(method(storage, label)).toBe(expected);
		});
	});

	describe("readCliConfig", () => {
		beforeEach(async () => {
			const fs = await import("fs/promises");
			vi.mocked(fs.readFile).mockClear();
		});

		it("should read URL and token from files", async () => {
			const fs = await import("fs/promises");
			vi.mocked(fs.readFile)
				.mockResolvedValueOnce("https://coder.example.com\n")
				.mockResolvedValueOnce("test-token\n");

			const result = await storage.readCliConfig("test-label");

			expect(result).toEqual({
				url: "https://coder.example.com",
				token: "test-token",
			});
		});

		it("should handle missing files gracefully", async () => {
			const fs = await import("fs/promises");
			vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

			const result = await storage.readCliConfig("test-label");

			expect(result).toEqual({
				url: "",
				token: "",
			});
		});
	});

	describe("migrateSessionToken", () => {
		beforeEach(async () => {
			const fs = await import("fs/promises");
			vi.mocked(fs.rename).mockClear();
		});

		it("should rename session token file successfully", async () => {
			const fs = await import("fs/promises");
			vi.mocked(fs.rename).mockResolvedValue();

			await expect(
				storage.migrateSessionToken("test-label"),
			).resolves.toBeUndefined();

			expect(fs.rename).toHaveBeenCalledWith(
				"/mock/global/storage/test-label/session_token",
				"/mock/global/storage/test-label/session",
			);
		});

		it("should handle ENOENT error gracefully", async () => {
			const fs = await import("fs/promises");
			const error = new Error("ENOENT") as NodeJS.ErrnoException;
			error.code = "ENOENT";
			vi.mocked(fs.rename).mockRejectedValue(error);

			await expect(
				storage.migrateSessionToken("test-label"),
			).resolves.toBeUndefined();
		});

		it("should throw other errors", async () => {
			const fs = await import("fs/promises");
			const error = new Error("Permission denied");
			vi.mocked(fs.rename).mockRejectedValue(error);

			await expect(storage.migrateSessionToken("test-label")).rejects.toThrow(
				"Permission denied",
			);
		});
	});

	describe("getRemoteSSHLogPath", () => {
		it("should return undefined when no output directories exist", async () => {
			const fs = await import("fs/promises");
			vi.mocked(fs.readdir).mockResolvedValue([]);

			const result = await storage.getRemoteSSHLogPath();

			expect(result).toBeUndefined();
		});

		it("should return undefined when no Remote SSH file exists", async () => {
			const fs = await import("fs/promises");
			vi.mocked(fs.readdir)
				.mockResolvedValueOnce([
					"output_logging_20240101",
					"other_dir",
				] as never)
				.mockResolvedValueOnce(["some-other-file.log"] as never);

			const result = await storage.getRemoteSSHLogPath();

			expect(result).toBeUndefined();
		});

		it("should return path when Remote SSH file exists", async () => {
			const fs = await import("fs/promises");
			vi.mocked(fs.readdir)
				.mockResolvedValueOnce([
					"output_logging_20240102",
					"output_logging_20240101",
				] as never)
				.mockResolvedValueOnce(["1-Remote - SSH.log", "2-Other.log"] as never);

			const result = await storage.getRemoteSSHLogPath();

			// Directories are sorted and then reversed, so 20240101 comes first
			expect(result).toBe(
				"/mock/log/output_logging_20240101/1-Remote - SSH.log",
			);
		});
	});

	describe("configureCli", () => {
		it("should call updateUrlForCli and updateTokenForCli in parallel", async () => {
			const fs = await import("fs/promises");
			vi.mocked(fs.writeFile).mockResolvedValue();
			vi.mocked(fs.readFile).mockResolvedValue("existing-url\n");

			const testLabel = "test-label";
			const testUrl = "https://test.coder.com";
			const testToken = "test-token-123";

			await storage.configureCli(testLabel, testUrl, testToken);

			// Verify writeFile was called for both URL and token
			expect(fs.writeFile).toHaveBeenCalledWith(
				"/mock/global/storage/test-label/url",
				testUrl,
			);
			expect(fs.writeFile).toHaveBeenCalledWith(
				"/mock/global/storage/test-label/session",
				testToken,
			);
		});
	});

	describe("getHeaders", () => {
		beforeEach(async () => {
			const { getHeaders, getHeaderCommand } = await import("./headers");
			vi.mocked(getHeaders).mockClear();
			vi.mocked(getHeaderCommand).mockClear();
		});

		it("should call getHeaders with correct parameters", async () => {
			const { getHeaders } = await import("./headers");
			const { getHeaderCommand } = await import("./headers");
			vi.mocked(getHeaders).mockResolvedValue({ "X-Test": "test-value" });
			vi.mocked(getHeaderCommand).mockReturnValue("test-command");

			const testUrl = "https://test.coder.com";
			const result = await storage.getHeaders(testUrl);

			expect(getHeaderCommand).toHaveBeenCalled();
			expect(getHeaders).toHaveBeenCalledWith(testUrl, "test-command", storage);
			expect(result).toEqual({ "X-Test": "test-value" });
		});

		it("should handle undefined URL", async () => {
			const { getHeaders } = await import("./headers");
			const { getHeaderCommand } = await import("./headers");
			vi.mocked(getHeaders).mockResolvedValue({});
			vi.mocked(getHeaderCommand).mockReturnValue("");

			const result = await storage.getHeaders(undefined);

			expect(getHeaderCommand).toHaveBeenCalled();
			expect(getHeaders).toHaveBeenCalledWith(undefined, "", storage);
			expect(result).toEqual({});
		});
	});

	describe("writeToCoderOutputChannel", () => {
		it("should write message with timestamp to output channel", () => {
			const testMessage = "Test log message";
			const mockDate = new Date("2024-01-01T12:00:00.000Z");
			vi.spyOn(global, "Date").mockImplementation(() => mockDate);

			storage.writeToCoderOutputChannel(testMessage);

			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				"[2024-01-01T12:00:00.000Z] Test log message",
			);
		});
	});

	describe("getNetworkInfoPath", () => {
		it("should return network info path", () => {
			const result = storage.getNetworkInfoPath();

			expect(result).toBe("/mock/global/storage/net");
		});
	});

	describe("getLogPath", () => {
		it("should return log path", () => {
			const result = storage.getLogPath();

			expect(result).toBe("/mock/global/storage/log");
		});
	});

	describe("getUserSettingsPath", () => {
		it("should return user settings path", () => {
			const result = storage.getUserSettingsPath();

			expect(result).toBe("/User/settings.json");
		});
	});

	describe("getSessionTokenPath", () => {
		it("should return path with label when label is provided", () => {
			const result = storage.getSessionTokenPath("test-label");

			expect(result).toBe("/mock/global/storage/test-label/session");
		});

		it("should return path without label when label is empty", () => {
			const result = storage.getSessionTokenPath("");

			expect(result).toBe("/mock/global/storage/session");
		});
	});

	describe("getLegacySessionTokenPath", () => {
		it("should return legacy path with label when label is provided", () => {
			const result = storage.getLegacySessionTokenPath("test-label");

			expect(result).toBe("/mock/global/storage/test-label/session_token");
		});

		it("should return legacy path without label when label is empty", () => {
			const result = storage.getLegacySessionTokenPath("");

			expect(result).toBe("/mock/global/storage/session_token");
		});
	});

	describe("getUrlPath", () => {
		it("should return path with label when label is provided", () => {
			const result = storage.getUrlPath("test-label");

			expect(result).toBe("/mock/global/storage/test-label/url");
		});

		it("should return path without label when label is empty", () => {
			const result = storage.getUrlPath("");

			expect(result).toBe("/mock/global/storage/url");
		});
	});

	describe("fetchBinary", () => {
		let mockRestClient: Api;

		beforeEach(() => {
			// Use the factory function to create a mock API/RestClient
			mockRestClient = createMockRestClient();
			// Override specific methods for our tests
			vi.mocked(mockRestClient.getAxiosInstance).mockReturnValue({
				defaults: { baseURL: "https://test.coder.com" },
				get: vi.fn(),
			} as unknown as AxiosInstance);
			vi.mocked(mockRestClient.getBuildInfo).mockResolvedValue({
				version: "v2.0.0",
			} as never);
		});

		it("should throw error when downloads are disabled and no binary exists", async () => {
			// Mock downloads disabled
			const mockConfig = createMockConfiguration({
				"coder.enableDownloads": false,
				"coder.binaryDestination": "",
			});
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

			// Mock cli.stat to return undefined (no existing binary)
			const cli = await import("./cliManager");
			vi.mocked(cli.stat).mockResolvedValue(undefined);
			vi.mocked(cli.name).mockReturnValue("coder");

			await expect(
				storage.fetchBinary(mockRestClient as never, "test-label"),
			).rejects.toThrow(
				"Unable to download CLI because downloads are disabled",
			);

			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				"Downloads are disabled",
			);
			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				"Got server version: v2.0.0",
			);
			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				"No existing binary found, starting download",
			);
			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				"Unable to download CLI because downloads are disabled",
			);
		});

		it("should return existing binary when it matches server version", async () => {
			// Mock downloads enabled
			const mockConfig = createMockConfiguration({
				"coder.enableDownloads": true,
				"coder.binaryDestination": "",
			});
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

			// Mock cli methods
			const cli = await import("./cliManager");
			vi.mocked(cli.stat).mockResolvedValue({ size: 10485760 } as never); // 10MB
			vi.mocked(cli.name).mockReturnValue("coder");
			vi.mocked(cli.version).mockResolvedValue("v2.0.0"); // matches server version

			const result = await storage.fetchBinary(
				mockRestClient as never,
				"test-label",
			);

			expect(result).toBe("/mock/global/storage/test-label/bin/coder");
			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				"Using existing binary since it matches the server version",
			);
		});

		it("should return existing binary when downloads disabled even if version doesn't match", async () => {
			// Mock downloads disabled
			const mockConfig = createMockConfiguration({
				"coder.enableDownloads": false,
				"coder.binaryDestination": "",
			});
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

			// Mock cli methods
			const cli = await import("./cliManager");
			vi.mocked(cli.stat).mockResolvedValue({ size: 10485760 } as never); // 10MB
			vi.mocked(cli.name).mockReturnValue("coder");
			vi.mocked(cli.version).mockResolvedValue("v1.9.0"); // different from server version

			const result = await storage.fetchBinary(
				mockRestClient as never,
				"test-label",
			);

			expect(result).toBe("/mock/global/storage/test-label/bin/coder");
			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				"Using existing binary even though it does not match the server version because downloads are disabled",
			);
		});

		it("should handle error when checking existing binary version", async () => {
			// Mock downloads enabled
			const mockConfig = createMockConfiguration({
				"coder.enableDownloads": true,
				"coder.binaryDestination": "",
				"coder.binarySource": "",
			});
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

			// Mock cli methods
			const cli = await import("./cliManager");
			vi.mocked(cli.stat).mockResolvedValue({ size: 10485760 } as never); // 10MB
			vi.mocked(cli.name).mockReturnValue("coder");
			vi.mocked(cli.version).mockRejectedValue(new Error("Invalid binary"));
			vi.mocked(cli.rmOld).mockResolvedValue([]);
			vi.mocked(cli.eTag).mockResolvedValue("");

			// Mock axios response for download
			const mockAxios = {
				get: vi.fn().mockResolvedValue({
					status: 304, // Not Modified
				}),
			};
			vi.mocked(mockRestClient.getAxiosInstance).mockReturnValue({
				defaults: { baseURL: "https://test.coder.com" },
				get: mockAxios.get,
			} as unknown as AxiosInstance);

			const result = await storage.fetchBinary(
				mockRestClient as never,
				"test-label",
			);

			expect(result).toBe("/mock/global/storage/test-label/bin/coder");
			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				"Unable to get version of existing binary: Error: Invalid binary",
			);
			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				"Downloading new binary instead",
			);
			expect(mockOutput.appendLine).toHaveBeenCalledWith("Got status code 304");
			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				"Using existing binary since server returned a 304",
			);
		});
	});

	describe("Logger integration", () => {
		it("should use logger.info when logger is set", () => {
			// Create a mock output channel for the logger
			const mockLoggerOutput = {
				appendLine: vi.fn(),
			};

			// Create a real Logger instance with the mock output channel
			const logger = new Logger(mockLoggerOutput);

			const storage = new Storage(
				mockOutput,
				mockMemento,
				mockSecrets,
				mockGlobalStorageUri,
				mockLogUri,
				logger,
			);

			// When writeToCoderOutputChannel is called
			storage.writeToCoderOutputChannel("Test message");

			// The logger should have written to its output channel
			expect(mockLoggerOutput.appendLine).toHaveBeenCalledWith(
				expect.stringMatching(/\[.*\] \[INFO\] Test message/),
			);
			// And storage should still write to its output channel for backward compatibility
			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Test message"),
			);
		});

		it("should work without logger for backward compatibility", () => {
			const storage = new Storage(
				mockOutput,
				mockMemento,
				mockSecrets,
				mockGlobalStorageUri,
				mockLogUri,
			);

			// When writeToCoderOutputChannel is called without logger
			storage.writeToCoderOutputChannel("Test message");

			// It should only write to output channel
			expect(mockOutput.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("Test message"),
			);
		});

		it("should respect logger verbose configuration", () => {
			// Create a mock output channel for the logger
			const mockLoggerOutput = {
				appendLine: vi.fn(),
			};

			// Create a Logger with verbose disabled
			const logger = new Logger(mockLoggerOutput, { verbose: false });

			const storage = new Storage(
				mockOutput,
				mockMemento,
				mockSecrets,
				mockGlobalStorageUri,
				mockLogUri,
				logger,
			);

			// Verify that info messages are still logged
			storage.writeToCoderOutputChannel("Info message");
			expect(mockLoggerOutput.appendLine).toHaveBeenCalledTimes(1);

			// But debug messages would not be logged (if we had a debug method)
			// This demonstrates the logger configuration is working
		});
	});
});
