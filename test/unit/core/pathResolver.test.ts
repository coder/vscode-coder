import * as path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PathResolver } from "@/core/pathResolver";

import { MockConfigurationProvider } from "../../mocks/testHelpers";
import { expectPathsEqual } from "../../utils/platform";

describe("PathResolver", () => {
	const basePath =
		"/home/user/.vscode-server/data/User/globalStorage/coder.coder-remote";
	const codeLogPath = "/home/user/.vscode-server/data/logs/coder.coder-remote";
	let pathResolver: PathResolver;
	let mockConfig: MockConfigurationProvider;

	beforeEach(() => {
		vi.unstubAllEnvs();
		pathResolver = new PathResolver(basePath, codeLogPath);
		mockConfig = new MockConfigurationProvider();
	});

	describe("getGlobalConfigDir", () => {
		it("uses per-deployment global storage when no override is configured", () => {
			vi.stubEnv("CODER_CONFIG_DIR", "");
			mockConfig.set("coder.globalConfig", "");

			expectPathsEqual(
				pathResolver.getGlobalConfigDir("deployment"),
				path.join(basePath, "deployment"),
			);
		});

		it("uses configured global config directory directly", () => {
			mockConfig.set("coder.globalConfig", "/custom/coderv2");

			expectPathsEqual(
				pathResolver.getGlobalConfigDir("deployment"),
				"/custom/coderv2",
			);
		});

		it("uses CODER_CONFIG_DIR when setting is empty", () => {
			vi.stubEnv("CODER_CONFIG_DIR", "  /env/coderv2  ");
			mockConfig.set("coder.globalConfig", "");

			expectPathsEqual(
				pathResolver.getGlobalConfigDir("deployment"),
				"/env/coderv2",
			);
		});

		it("uses setting before CODER_CONFIG_DIR", () => {
			vi.stubEnv("CODER_CONFIG_DIR", "/env/coderv2");
			mockConfig.set("coder.globalConfig", "  /setting/coderv2  ");

			expectPathsEqual(
				pathResolver.getGlobalConfigDir("deployment"),
				"/setting/coderv2",
			);
		});

		it("normalizes configured global config directory", () => {
			mockConfig.set("coder.globalConfig", "/custom/../coderv2/./dir");

			expectPathsEqual(
				pathResolver.getGlobalConfigDir("deployment"),
				"/coderv2/dir",
			);
		});

		it("expands paths in configured global config directory", () => {
			mockConfig.set("coder.globalConfig", "~/coderv2");
			const result = pathResolver.getGlobalConfigDir("deployment");

			expect(result).not.toContain("~");
			expect(result).toContain("coderv2");
		});

		it("expands paths in CODER_CONFIG_DIR", () => {
			vi.stubEnv("CODER_CONFIG_DIR", "~/coderv2");
			const result = pathResolver.getGlobalConfigDir("deployment");

			expect(result).not.toContain("~");
			expect(result).toContain("coderv2");
		});
	});

	describe("getProxyLogPath", () => {
		const defaultLogPath = path.join(basePath, "log");

		it.each([
			{ setting: "/custom/log/dir", expected: "/custom/log/dir" },
			{ setting: "", expected: defaultLogPath },
			{ setting: "   ", expected: defaultLogPath },
			{ setting: undefined, expected: defaultLogPath },
		])(
			"should return $expected when setting is '$setting'",
			({ setting, expected }) => {
				if (setting !== undefined) {
					mockConfig.set("coder.proxyLogDirectory", setting);
				}
				expectPathsEqual(pathResolver.getProxyLogPath(), expected);
			},
		);

		it("should expand tilde and ${userHome} in configured path", () => {
			mockConfig.set("coder.proxyLogDirectory", "~/logs");
			expect(pathResolver.getProxyLogPath()).not.toContain("~");

			mockConfig.set("coder.proxyLogDirectory", "${userHome}/logs");
			expect(pathResolver.getProxyLogPath()).not.toContain("${userHome}");
		});

		it("should normalize configured path", () => {
			mockConfig.set("coder.proxyLogDirectory", "/custom/../log/./dir");
			expectPathsEqual(pathResolver.getProxyLogPath(), "/log/dir");
		});

		it("should use CODER_SSH_LOG_DIR environment variable with proper precedence", () => {
			// Use the global storage when the environment variable and setting are unset/blank
			vi.stubEnv("CODER_SSH_LOG_DIR", "");
			mockConfig.set("coder.proxyLogDirectory", "");
			expectPathsEqual(pathResolver.getProxyLogPath(), defaultLogPath);

			// Test environment variable takes precedence over global storage
			vi.stubEnv("CODER_SSH_LOG_DIR", "   /env/log/path   ");
			expectPathsEqual(pathResolver.getProxyLogPath(), "/env/log/path");

			// Test setting takes precedence over environment variable
			mockConfig.set("coder.proxyLogDirectory", "  /setting/log/path  ");
			expectPathsEqual(pathResolver.getProxyLogPath(), "/setting/log/path");
		});

		it("should expand tilde in CODER_SSH_LOG_DIR", () => {
			vi.stubEnv("CODER_SSH_LOG_DIR", "~/logs");
			const result = pathResolver.getProxyLogPath();
			expect(result).not.toContain("~");
			expect(result).toContain("logs");
		});
	});

	describe("getBinaryCachePath", () => {
		it("should use custom binary destination when configured", () => {
			mockConfig.set("coder.binaryDestination", "/custom/binary/path");
			expectPathsEqual(
				pathResolver.getBinaryCachePath("deployment"),
				"/custom/binary/path",
			);
		});

		it("should use default path when custom destination is empty or whitespace", () => {
			vi.stubEnv("CODER_BINARY_DESTINATION", "   ");
			mockConfig.set("coder.binaryDestination", "   ");
			expectPathsEqual(
				pathResolver.getBinaryCachePath("deployment"),
				path.join(basePath, "deployment", "bin"),
			);
		});

		it("should normalize custom paths", () => {
			mockConfig.set("coder.binaryDestination", "/custom/../binary/./path");
			expectPathsEqual(
				pathResolver.getBinaryCachePath("deployment"),
				"/binary/path",
			);
		});

		it("should expand tilde in configured path", () => {
			mockConfig.set("coder.binaryDestination", "~/bin");
			const result = pathResolver.getBinaryCachePath("deployment");
			expect(result).not.toContain("~");
			expect(result).toContain("bin");
		});

		it("should expand tilde in CODER_BINARY_DESTINATION", () => {
			vi.stubEnv("CODER_BINARY_DESTINATION", "~/bin");
			const result = pathResolver.getBinaryCachePath("deployment");
			expect(result).not.toContain("~");
			expect(result).toContain("bin");
		});

		it("should use CODER_BINARY_DESTINATION environment variable with proper precedence", () => {
			// Use the global storage when the environment variable and setting are unset/blank
			vi.stubEnv("CODER_BINARY_DESTINATION", "");
			mockConfig.set("coder.binaryDestination", "");
			expectPathsEqual(
				pathResolver.getBinaryCachePath("deployment"),
				path.join(basePath, "deployment", "bin"),
			);

			// Test environment variable takes precedence over global storage
			vi.stubEnv("CODER_BINARY_DESTINATION", "   /env/binary/path   ");
			expectPathsEqual(
				pathResolver.getBinaryCachePath("deployment"),
				"/env/binary/path",
			);

			// Test setting takes precedence over environment variable
			mockConfig.set("coder.binaryDestination", "  /setting/path  ");
			expectPathsEqual(
				pathResolver.getBinaryCachePath("deployment"),
				"/setting/path",
			);
		});
	});
});
