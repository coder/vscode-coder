import fs from "fs/promises";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

import * as cliExec from "@/core/cliExec";

import { MockConfigurationProvider } from "../../mocks/testHelpers";
import { isWindows, writeExecutable } from "../../utils/platform";

import type { CliEnv } from "@/core/cliExec";

describe("cliExec", () => {
	const tmp = path.join(os.tmpdir(), "vscode-coder-tests-cliExec");

	beforeAll(async () => {
		await fs.rm(tmp, { recursive: true, force: true });
		await fs.mkdir(tmp, { recursive: true });
	});

	/** JS code for a fake CLI that writes a fixed string to stdout. */
	function echoBin(output: string): string {
		return `process.stdout.write(${JSON.stringify(output)});`;
	}

	/**
	 * JS code for a fake old CLI that rejects --output with stderr,
	 * and otherwise writes to stdout.
	 */
	function oldCliBin(stderr: string, stdout: string): string {
		return [
			`if (process.argv.includes("--output")) {`,
			`  process.stderr.write(${JSON.stringify(stderr)});`,
			`  process.exitCode = 1;`,
			`} else {`,
			`  process.stdout.write(${JSON.stringify(stdout)});`,
			`}`,
		].join("\n");
	}

	describe("version", () => {
		it("throws when binary does not exist", async () => {
			const missing = path.join(tmp, "nonexistent");
			await expect(cliExec.version(missing)).rejects.toThrow("ENOENT");
		});

		it.skipIf(isWindows())("throws when binary is not executable", async () => {
			const noExec = path.join(tmp, "version-noperm");
			await fs.writeFile(noExec, "hello");
			await expect(cliExec.version(noExec)).rejects.toThrow("EACCES");
		});

		it("throws on invalid JSON output", async () => {
			const bin = await writeExecutable(tmp, "ver-bad-json", echoBin("hello"));
			await expect(cliExec.version(bin)).rejects.toThrow("Unexpected token");
		});

		it("throws when JSON has no version field", async () => {
			const bin = await writeExecutable(tmp, "ver-no-field", echoBin("{}"));
			await expect(cliExec.version(bin)).rejects.toThrow(
				"No version found in output",
			);
		});

		it("parses version from JSON output", async () => {
			const bin = await writeExecutable(
				tmp,
				"ver-ok",
				echoBin(JSON.stringify({ version: "v0.0.0" })),
			);
			expect(await cliExec.version(bin)).toBe("v0.0.0");
		});

		it("re-throws non-output errors from old CLI", async () => {
			const bin = await writeExecutable(
				tmp,
				"ver-old-err",
				oldCliBin("foobar", "Coder v1.1.1"),
			);
			await expect(cliExec.version(bin)).rejects.toThrow("foobar");
		});

		it("falls back to plain version for old CLI", async () => {
			const bin = await writeExecutable(
				tmp,
				"ver-old-ok",
				oldCliBin("unknown flag: --output", "Coder v1.1.1"),
			);
			expect(await cliExec.version(bin)).toBe("v1.1.1");
		});

		it("trims trailing newlines from old CLI", async () => {
			const bin = await writeExecutable(
				tmp,
				"ver-old-trim",
				oldCliBin("unknown flag: --output\n", "Coder v1.1.1\n"),
			);
			expect(await cliExec.version(bin)).toBe("v1.1.1");
		});

		it("re-throws when old CLI output is not Coder", async () => {
			const bin = await writeExecutable(
				tmp,
				"ver-old-unrelated",
				oldCliBin("unknown flag: --output", "Unrelated"),
			);
			await expect(cliExec.version(bin)).rejects.toThrow("unknown flag");
		});

		it("throws when old CLI has no version after Coder prefix", async () => {
			const bin = await writeExecutable(
				tmp,
				"ver-old-noversion",
				oldCliBin("unknown flag: --output", "Coder"),
			);
			await expect(cliExec.version(bin)).rejects.toThrow("No version found");
		});
	});

	describe("speedtest", () => {
		let echoArgsBin: string;

		beforeAll(async () => {
			const code = `process.argv.slice(2).forEach(a => console.log(a));`;
			echoArgsBin = await writeExecutable(tmp, "echo-args", code);
		});

		function setup(auth: CliEnv["auth"], binary = echoArgsBin) {
			const configs = new MockConfigurationProvider();
			const env: CliEnv = { binary, auth, configs };
			return { configs, env };
		}

		it("passes global-config auth flags", async () => {
			const { env } = setup({
				mode: "global-config",
				configDir: "/tmp/test-config",
			});
			const result = await cliExec.speedtest(env, "owner/workspace");
			const args = result.trim().split("\n");
			expect(args).toEqual([
				"--global-config",
				"/tmp/test-config",
				"speedtest",
				"owner/workspace",
				"--output",
				"json",
			]);
		});

		it("passes url auth flags", async () => {
			const { env } = setup({
				mode: "url",
				url: "http://localhost:3000",
			});
			const result = await cliExec.speedtest(env, "owner/workspace");
			const args = result.trim().split("\n");
			expect(args).toEqual([
				"--url",
				"http://localhost:3000",
				"speedtest",
				"owner/workspace",
				"--output",
				"json",
			]);
		});

		it("passes duration flag", async () => {
			const { env } = setup({
				mode: "url",
				url: "http://localhost:3000",
			});
			const result = await cliExec.speedtest(env, "owner/workspace", "10s");
			const args = result.trim().split("\n");
			expect(args).toEqual([
				"--url",
				"http://localhost:3000",
				"speedtest",
				"owner/workspace",
				"--output",
				"json",
				"-t",
				"10s",
			]);
		});

		it("passes header command", async () => {
			const { configs, env } = setup({
				mode: "url",
				url: "http://localhost:3000",
			});
			configs.set("coder.headerCommand", "my-header-cmd");
			const result = await cliExec.speedtest(env, "owner/workspace");
			const args = result.trim().split("\n");
			expect(args).toContain("--header-command");
		});

		it("throws when binary does not exist", async () => {
			const { env } = setup(
				{
					mode: "global-config",
					configDir: "/tmp",
				},
				"/nonexistent/binary",
			);
			await expect(cliExec.speedtest(env, "owner/workspace")).rejects.toThrow(
				"ENOENT",
			);
		});

		it("surfaces stderr instead of full command line on failure", async () => {
			const code = [
				`process.stderr.write("invalid argument for -t flag\\n");`,
				`process.exitCode = 1;`,
			].join("\n");
			const bin = await writeExecutable(tmp, "speedtest-err", code);
			const { env } = setup({ mode: "global-config", configDir: "/tmp" }, bin);
			await expect(
				cliExec.speedtest(env, "owner/workspace", "bad"),
			).rejects.toThrow("invalid argument for -t flag");
		});
	});

	describe("isGoDuration", () => {
		it.each([
			"5s",
			"10m",
			"1h",
			"1h30m",
			"500ms",
			"1.5s",
			"2h45m10s",
			"100ns",
			"50us",
			"50µs",
		])("accepts %s", (v) => expect(cliExec.isGoDuration(v)).toBe(true));

		it.each(["", "bjbmn", "5", "s", "5x", "1h 30m", "-5s", "5S"])(
			"rejects %s",
			(v) => expect(cliExec.isGoDuration(v)).toBe(false),
		);
	});
});
