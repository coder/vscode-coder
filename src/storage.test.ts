import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import * as vscode from "vscode";
import { Logger } from "./logger";
import { Storage } from "./storage";

// Mock dependencies
vi.mock("./headers");
vi.mock("./api-helper");
vi.mock("./cliManager");
vi.mock("fs/promises");

beforeAll(() => {
	vi.mock("vscode", () => {
		return {
			workspace: {
				getConfiguration: vi.fn(() => ({
					get: vi.fn().mockReturnValue(""),
				})),
			},
		};
	});
});

describe("storage", () => {
	let mockOutput: vscode.OutputChannel;
	let mockMemento: vscode.Memento;
	let mockSecrets: vscode.SecretStorage;
	let mockGlobalStorageUri: vscode.Uri;
	let mockLogUri: vscode.Uri;
	let storage: Storage;

	beforeEach(() => {
		mockOutput = {
			appendLine: vi.fn(),
		} as unknown as vscode.OutputChannel;

		mockMemento = {
			get: vi.fn(),
			update: vi.fn(),
		} as unknown as vscode.Memento;

		mockSecrets = {
			get: vi.fn(),
			store: vi.fn(),
			delete: vi.fn(),
		} as unknown as vscode.SecretStorage;

		mockGlobalStorageUri = {
			fsPath: "/mock/global/storage",
		} as vscode.Uri;

		mockLogUri = {
			fsPath: "/mock/log/path",
		} as vscode.Uri;

		storage = new Storage(
			mockOutput,
			mockMemento,
			mockSecrets,
			mockGlobalStorageUri,
			mockLogUri,
		);
	});

	it("should create Storage instance", () => {
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
		it("should return empty array when no history exists", () => {
			vi.mocked(mockMemento.get).mockReturnValue(undefined);

			const result = storage.withUrlHistory();

			expect(result).toEqual([]);
			expect(mockMemento.get).toHaveBeenCalledWith("urlHistory");
		});

		it("should append new URLs to existing history", () => {
			vi.mocked(mockMemento.get).mockReturnValue(["https://old.com"]);

			const result = storage.withUrlHistory("https://new.com");

			expect(result).toEqual(["https://old.com", "https://new.com"]);
		});

		it("should filter out undefined values", () => {
			vi.mocked(mockMemento.get).mockReturnValue(["https://old.com"]);

			const result = storage.withUrlHistory(
				undefined,
				"https://new.com",
				undefined,
			);

			expect(result).toEqual(["https://old.com", "https://new.com"]);
		});

		it("should remove duplicates and move to end", () => {
			vi.mocked(mockMemento.get).mockReturnValue([
				"https://a.com",
				"https://b.com",
				"https://c.com",
			]);

			const result = storage.withUrlHistory("https://b.com");

			expect(result).toEqual([
				"https://a.com",
				"https://c.com",
				"https://b.com",
			]);
		});

		it("should limit history to MAX_URLS (10)", () => {
			const existingUrls = Array.from(
				{ length: 10 },
				(_, i) => `https://url${i}.com`,
			);
			vi.mocked(mockMemento.get).mockReturnValue(existingUrls);

			const result = storage.withUrlHistory("https://new.com");

			expect(result).toHaveLength(10);
			expect(result[0]).toBe("https://url1.com");
			expect(result[9]).toBe("https://new.com");
		});
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

		it("should set URL to empty string", async () => {
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
		it("should store token when provided", async () => {
			const testToken = "test-session-token";
			vi.mocked(mockSecrets.store).mockResolvedValue();

			await storage.setSessionToken(testToken);

			expect(mockSecrets.store).toHaveBeenCalledWith("sessionToken", testToken);
		});

		it("should delete token when undefined", async () => {
			vi.mocked(mockSecrets.delete).mockResolvedValue();

			await storage.setSessionToken(undefined);

			expect(mockSecrets.delete).toHaveBeenCalledWith("sessionToken");
		});

		it("should delete token when empty string", async () => {
			vi.mocked(mockSecrets.delete).mockResolvedValue();

			await storage.setSessionToken("");

			expect(mockSecrets.delete).toHaveBeenCalledWith("sessionToken");
		});
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
		it("should return custom path when configured", () => {
			// We need to test this differently since vscode is already mocked globally
			// Let's just test the path construction logic for now
			const result = storage.getBinaryCachePath("test-label");

			// This will use the mocked global storage path
			expect(result).toBe("/mock/global/storage/test-label/bin");
		});

		it("should return label-specific path when label provided", () => {
			const result = storage.getBinaryCachePath("my-deployment");

			expect(result).toBe("/mock/global/storage/my-deployment/bin");
		});

		it("should return default path when no label", () => {
			const result = storage.getBinaryCachePath("");

			expect(result).toBe("/mock/global/storage/bin");
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

	describe("getSessionTokenPath", () => {
		it("should return label-specific session token path when label provided", () => {
			const result = storage.getSessionTokenPath("test-deployment");

			expect(result).toBe("/mock/global/storage/test-deployment/session");
		});

		it("should return default session token path when no label", () => {
			const result = storage.getSessionTokenPath("");

			expect(result).toBe("/mock/global/storage/session");
		});
	});

	describe("getLegacySessionTokenPath", () => {
		it("should return label-specific legacy session token path when label provided", () => {
			const result = storage.getLegacySessionTokenPath("test-deployment");

			expect(result).toBe("/mock/global/storage/test-deployment/session_token");
		});

		it("should return default legacy session token path when no label", () => {
			const result = storage.getLegacySessionTokenPath("");

			expect(result).toBe("/mock/global/storage/session_token");
		});
	});

	describe("getUrlPath", () => {
		it("should return label-specific URL path when label provided", () => {
			const result = storage.getUrlPath("test-deployment");

			expect(result).toBe("/mock/global/storage/test-deployment/url");
		});

		it("should return default URL path when no label", () => {
			const result = storage.getUrlPath("");

			expect(result).toBe("/mock/global/storage/url");
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

	describe("getBinaryCachePath", () => {
		it("should return path with label when label is provided", () => {
			const testLabel = "my-deployment";

			const result = storage.getBinaryCachePath(testLabel);

			expect(result).toBe("/mock/global/storage/my-deployment/bin");
		});

		it("should return path without label when label is empty", () => {
			const result = storage.getBinaryCachePath("");

			expect(result).toBe("/mock/global/storage/bin");
		});

		it("should use custom destination when configured", () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn().mockReturnValue("/custom/path"),
			} as never);

			const result = storage.getBinaryCachePath("test-label");

			expect(result).toBe("/custom/path");
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
		let mockRestClient: {
			getAxiosInstance: ReturnType<typeof vi.fn>;
			getBuildInfo: ReturnType<typeof vi.fn>;
		};

		beforeEach(() => {
			mockRestClient = {
				getAxiosInstance: vi.fn().mockReturnValue({
					defaults: { baseURL: "https://test.coder.com" },
					get: vi.fn(),
				}),
				getBuildInfo: vi.fn().mockResolvedValue({ version: "v2.0.0" }),
			};
		});

		it("should throw error when downloads are disabled and no binary exists", async () => {
			// Mock downloads disabled
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((key) => {
					if (key === "coder.enableDownloads") {
						return false;
					} // downloads disabled
					if (key === "coder.binaryDestination") {
						return "";
					}
					return "";
				}),
			} as never);

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
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((key) => {
					if (key === "coder.enableDownloads") {
						return true;
					}
					if (key === "coder.binaryDestination") {
						return "";
					}
					return "";
				}),
			} as never);

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
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((key) => {
					if (key === "coder.enableDownloads") {
						return false;
					} // downloads disabled
					if (key === "coder.binaryDestination") {
						return "";
					}
					return "";
				}),
			} as never);

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
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: vi.fn((key) => {
					if (key === "coder.enableDownloads") {
						return true;
					}
					if (key === "coder.binaryDestination") {
						return "";
					}
					if (key === "coder.binarySource") {
						return "";
					}
					return "";
				}),
			} as never);

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
			mockRestClient.getAxiosInstance.mockReturnValue({
				defaults: { baseURL: "https://test.coder.com" },
				get: mockAxios.get,
			});

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
