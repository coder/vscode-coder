import { describe, expect, it } from "vitest";

import {
	expectPathsEqual,
	exitCommand,
	printCommand,
	printEnvCommand,
	isWindows,
} from "./platform";

describe("platform utils", () => {
	describe("printCommand", () => {
		it("should generate a simple node command", () => {
			const result = printCommand("hello world");
			expect(result).toBe("node -e \"process.stdout.write('hello world')\"");
		});

		it("should escape special characters", () => {
			const result = printCommand('path\\to\\file\'s "name"\nline2\rcarriage');
			expect(result).toBe(
				'node -e "process.stdout.write(\'path\\\\to\\\\file\\\'s \\"name\\"\\nline2\\rcarriage\')"',
			);
		});
	});

	describe("exitCommand", () => {
		it("should generate node commands with various exit codes", () => {
			expect(exitCommand(0)).toBe('node -e "process.exit(0)"');
			expect(exitCommand(1)).toBe('node -e "process.exit(1)"');
			expect(exitCommand(42)).toBe('node -e "process.exit(42)"');
			expect(exitCommand(-1)).toBe('node -e "process.exit(-1)"');
		});
	});

	describe("printEnvCommand", () => {
		it("should generate node commands that print env variables", () => {
			expect(printEnvCommand("url", "CODER_URL")).toBe(
				"node -e \"process.stdout.write('url=' + process.env.CODER_URL)\"",
			);
			expect(printEnvCommand("token", "CODER_TOKEN")).toBe(
				"node -e \"process.stdout.write('token=' + process.env.CODER_TOKEN)\"",
			);
			// Will fail to execute but that's fine
			expect(printEnvCommand("", "")).toBe(
				"node -e \"process.stdout.write('=' + process.env.)\"",
			);
		});
	});

	describe("expectPathsEqual", () => {
		it("should consider identical paths equal", () => {
			expectPathsEqual("same/path", "same/path");
		});

		it("should throw when paths are different", () => {
			expect(() =>
				expectPathsEqual("path/to/file1", "path/to/file2"),
			).toThrow();
		});

		it("should handle empty paths", () => {
			expectPathsEqual("", "");
		});

		it.runIf(isWindows())(
			"should consider paths with different separators equal on Windows",
			() => {
				expectPathsEqual("path/to/file", "path\\to\\file");
				expectPathsEqual("C:/path/to/file", "C:\\path\\to\\file");
				expectPathsEqual(
					"C:/path with spaces/file",
					"C:\\path with spaces\\file",
				);
			},
		);

		it.skipIf(isWindows())(
			"should consider backslash as literal on non-Windows",
			() => {
				expect(() =>
					expectPathsEqual("path/to/file", "path\\to\\file"),
				).toThrow();
			},
		);
	});
});
