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

	it("should generate deployment-specific paths", () => {
		const label = "my-deployment";

		expect(pathResolver.getGlobalConfigDir(label)).toBe(
			path.join(basePath, label),
		);
		expect(pathResolver.getSessionTokenPath(label)).toBe(
			path.join(basePath, label, "session"),
		);
		expect(pathResolver.getLegacySessionTokenPath(label)).toBe(
			path.join(basePath, label, "session_token"),
		);
		expect(pathResolver.getUrlPath(label)).toBe(
			path.join(basePath, label, "url"),
		);
	});

	it("should use base path for empty labels", () => {
		expect(pathResolver.getGlobalConfigDir("")).toBe(basePath);
		expect(pathResolver.getSessionTokenPath("")).toBe(
			path.join(basePath, "session"),
		);
		expect(pathResolver.getUrlPath("")).toBe(path.join(basePath, "url"));
	});

	it("should return static paths correctly", () => {
		expect(pathResolver.getNetworkInfoPath()).toBe(path.join(basePath, "net"));
		expect(pathResolver.getLogPath()).toBe(path.join(basePath, "log"));
		expect(pathResolver.getCodeLogDir()).toBe(codeLogPath);
		expect(pathResolver.getUserSettingsPath()).toBe(
			path.join(basePath, "..", "..", "..", "User", "settings.json"),
		);
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
