import fs from "fs/promises";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliConfigManager } from "./cliConfig";
import { PathResolver } from "./pathResolver";

vi.mock("fs/promises");

describe("CliConfigManager", () => {
	let pathResolver: PathResolver;
	let cliConfigManager: CliConfigManager;
	const mockFs = vi.mocked(fs);
	const writtenFiles = new Map<string, string>();

	beforeEach(() => {
		vi.resetAllMocks();
		writtenFiles.clear();
		pathResolver = new PathResolver("/test/base", "/test/log");
		cliConfigManager = new CliConfigManager(pathResolver);

		mockFs.mkdir.mockResolvedValue(undefined);
		mockFs.writeFile.mockImplementation(async (path, content) => {
			writtenFiles.set(path.toString(), content.toString());
			return Promise.resolve();
		});
	});

	describe("configure", () => {
		it("should write both url and token to correct paths", async () => {
			await cliConfigManager.configure(
				"deployment",
				"https://coder.example.com",
				"test-token",
			);

			expect([...writtenFiles.entries()]).toEqual([
				["/test/base/deployment/url", "https://coder.example.com"],
				["/test/base/deployment/session", "test-token"],
			]);
		});

		it("should skip URL when undefined but write token", async () => {
			await cliConfigManager.configure("deployment", undefined, "test-token");

			// No entry for the url
			expect([...writtenFiles.entries()]).toEqual([
				["/test/base/deployment/session", "test-token"],
			]);
		});

		it("should skip token when null but write URL", async () => {
			await cliConfigManager.configure(
				"deployment",
				"https://coder.example.com",
				null,
			);

			// No entry for the session
			expect([...writtenFiles.entries()]).toEqual([
				["/test/base/deployment/url", "https://coder.example.com"],
			]);
		});

		it("should write empty string for token when provided", async () => {
			await cliConfigManager.configure(
				"deployment",
				"https://coder.example.com",
				"",
			);

			expect([...writtenFiles.entries()]).toEqual([
				["/test/base/deployment/url", "https://coder.example.com"],
				["/test/base/deployment/session", ""],
			]);
		});

		it("should use base path directly when label is empty", async () => {
			await cliConfigManager.configure(
				"",
				"https://coder.example.com",
				"token",
			);

			expect([...writtenFiles.entries()]).toEqual([
				["/test/base/url", "https://coder.example.com"],
				["/test/base/session", "token"],
			]);
		});
	});

	describe("readConfig", () => {
		beforeEach(() => {
			mockFs.readFile.mockImplementation(async (filePath) => {
				const path = filePath.toString();
				if (writtenFiles.has(path)) {
					return writtenFiles.get(path)!;
				}
				return Promise.reject(new Error("ENOENT: no such file or directory"));
			});
		});

		it("should read and trim stored configuration", async () => {
			writtenFiles.set(
				"/test/base/deployment/url",
				"  https://coder.example.com  \n",
			);
			writtenFiles.set("/test/base/deployment/session", "\t test-token \r\n");

			const result = await cliConfigManager.readConfig("deployment");

			expect(result).toEqual({
				url: "https://coder.example.com",
				token: "test-token",
			});
		});

		it("should return empty strings for missing files", async () => {
			const result = await cliConfigManager.readConfig("deployment");

			expect(result).toEqual({
				url: "",
				token: "",
			});
		});

		it("should handle partial configuration", async () => {
			writtenFiles.set(
				"/test/base/deployment/url",
				"https://coder.example.com",
			);

			const result = await cliConfigManager.readConfig("deployment");

			expect(result).toEqual({
				url: "https://coder.example.com",
				token: "",
			});
		});
	});
});
