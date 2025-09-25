import * as path from "path";
import { describe, it, expect, beforeEach } from "vitest";
import { MockConfigurationProvider } from "../__mocks__/testHelpers";
import { PathResolver } from "./pathResolver";

describe("PathResolver", () => {
	const basePath =
		"/home/user/.vscode-server/data/User/globalStorage/coder.coder-remote";
	const codeLogPath = "/home/user/.vscode-server/data/logs/coder.coder-remote";
	let pathResolver: PathResolver;
	let mockConfig: MockConfigurationProvider;

	beforeEach(() => {
		pathResolver = new PathResolver(basePath, codeLogPath);
		mockConfig = new MockConfigurationProvider();
	});

	it("should use base path for empty labels", () => {
		expect(pathResolver.getGlobalConfigDir("")).toBe(basePath);
		expect(pathResolver.getSessionTokenPath("")).toBe(
			path.join(basePath, "session"),
		);
		expect(pathResolver.getUrlPath("")).toBe(path.join(basePath, "url"));
	});

	describe("getBinaryCachePath", () => {
		it("should use custom binary destination when configured", () => {
			mockConfig.set("coder.binaryDestination", "/custom/binary/path");
			expect(pathResolver.getBinaryCachePath("deployment")).toBe(
				"/custom/binary/path",
			);
		});

		it("should use default path when custom destination is empty or whitespace", () => {
			mockConfig.set("coder.binaryDestination", "   ");
			expect(pathResolver.getBinaryCachePath("deployment")).toBe(
				path.join(basePath, "deployment", "bin"),
			);
		});

		it("should normalize custom paths", () => {
			mockConfig.set("coder.binaryDestination", "/custom/../binary/./path");
			expect(pathResolver.getBinaryCachePath("deployment")).toBe(
				path.normalize("/custom/../binary/./path"),
			);
		});
	});
});
