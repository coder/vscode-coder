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

	it("should use base path for empty labels", () => {
		expectPathsEqual(pathResolver.getGlobalConfigDir(""), basePath);
		expectPathsEqual(
			pathResolver.getSessionTokenPath(""),
			path.join(basePath, "session"),
		);
		expectPathsEqual(pathResolver.getUrlPath(""), path.join(basePath, "url"));
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
