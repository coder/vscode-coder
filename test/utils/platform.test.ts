import * as cp from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import {
	expectPathsEqual,
	exitCommand,
	isWindows,
	printCommand,
	printEnvCommand,
	shellQuote,
	shimExecFile,
	writeExecutable,
	writeStdoutJs,
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

	describe("writeExecutable", () => {
		const tmp = path.join(os.tmpdir(), "vscode-coder-tests-platform");

		beforeAll(async () => {
			await fs.rm(tmp, { recursive: true, force: true });
			await fs.mkdir(tmp, { recursive: true });
		});

		it("writes a .js file and returns its path", async () => {
			const result = await writeExecutable(tmp, "test-script", "// hello");
			expect(result).toBe(path.join(tmp, "test-script.js"));
			expect(await fs.readFile(result, "utf-8")).toBe("// hello");
		});

		it("overwrites existing files", async () => {
			await writeExecutable(tmp, "overwrite", "first");
			const result = await writeExecutable(tmp, "overwrite", "second");
			expect(await fs.readFile(result, "utf-8")).toBe("second");
		});
	});

	describe("shimExecFile", () => {
		const tmp = path.join(os.tmpdir(), "vscode-coder-tests-shim");
		const mod = shimExecFile(cp);
		const execFileAsync = promisify(mod.execFile);

		beforeAll(async () => {
			await fs.rm(tmp, { recursive: true, force: true });
			await fs.mkdir(tmp, { recursive: true });
		});

		it("runs .js files through node", async () => {
			const script = await writeExecutable(tmp, "echo", writeStdoutJs("ok"));
			const { stdout } = await execFileAsync(script);
			expect(stdout).toBe("ok");
		});

		it("passes args through to the script", async () => {
			const script = await writeExecutable(
				tmp,
				"echo-args",
				`require("fs").writeSync(1, process.argv.slice(2).join(","));`,
			);
			const { stdout } = await execFileAsync(script, ["a", "b", "c"]);
			expect(stdout).toBe("a,b,c");
		});

		it("does not rewrite non-.js files", async () => {
			await expect(execFileAsync("/nonexistent/binary")).rejects.toThrow(
				"ENOENT",
			);
		});

		it("preserves the callback form", async () => {
			const script = await writeExecutable(tmp, "cb-echo", writeStdoutJs("cb"));
			const stdout = await new Promise<string>((resolve, reject) => {
				mod.execFile(script, (err, out) =>
					err ? reject(new Error(err.message)) : resolve(out),
				);
			});
			expect(stdout).toBe("cb");
		});

		it("does not touch spawn", () => {
			expect(mod.spawn).toBe(cp.spawn);
		});
	});

	describe("shellQuote", () => {
		const platformSpy = vi.spyOn(os, "platform");
		afterEach(() => platformSpy.mockReset());

		describe("on Unix", () => {
			beforeEach(() => platformSpy.mockReturnValue("linux"));

			it("wraps in single quotes", () => {
				expect(shellQuote("env=dev")).toBe("'env=dev'");
			});

			it("escapes single quotes via the '\\'' sequence", () => {
				expect(shellQuote("it's fine")).toBe("'it'\\''s fine'");
			});

			it("keeps $VAR, $(...), and backticks literal inside the quotes", () => {
				expect(shellQuote("$(echo pwned)")).toBe("'$(echo pwned)'");
			});
		});

		describe("on Windows", () => {
			beforeEach(() => platformSpy.mockReturnValue("win32"));

			it("wraps in double quotes", () => {
				expect(shellQuote("env=dev")).toBe('"env=dev"');
			});

			it("escapes embedded double quotes", () => {
				expect(shellQuote('regions=["us","eu"]')).toBe(
					String.raw`"regions=[\"us\",\"eu\"]"`,
				);
			});

			it("doubles percent signs to block %VAR% expansion", () => {
				expect(shellQuote("%PATH%")).toBe('"%%PATH%%"');
			});
		});
	});
});
