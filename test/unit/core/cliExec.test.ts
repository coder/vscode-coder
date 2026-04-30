import fs from "fs/promises";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { MockConfigurationProvider } from "../../mocks/testHelpers";
import { isWindows, quoteCommand, writeExecutable } from "../../utils/platform";

import type { CliEnv } from "@/core/cliExec";

// Shim execFile so .js test scripts are run through node cross-platform.
vi.mock("node:child_process", async (importOriginal) => {
	const { shimExecFile } = await import("../../utils/platform");
	return shimExecFile(await importOriginal());
});

// Import after mock so the module picks up the shimmed execFile.
const cliExec = await import("@/core/cliExec");

describe("cliExec", () => {
	const tmp = path.join(os.tmpdir(), "vscode-coder-tests-cliExec");
	let echoArgsBin: string;

	beforeAll(async () => {
		await fs.rm(tmp, { recursive: true, force: true });
		await fs.mkdir(tmp, { recursive: true });
		const code = `process.argv.slice(2).forEach(a => console.log(a));`;
		echoArgsBin = await writeExecutable(tmp, "echo-args", code);
	});

	function setup(auth: CliEnv["auth"], binary = echoArgsBin) {
		const configs = new MockConfigurationProvider();
		const env: CliEnv = {
			binary,
			auth,
			configs,
			authEnv: { url: "http://localhost:3000", token: "test-token" },
		};
		return { configs, env };
	}

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
		it("passes global, header, and command-specific flags", async () => {
			const { configs, env } = setup({
				mode: "url",
				url: "http://localhost:3000",
			});
			configs.set("coder.headerCommand", "my-header-cmd");
			const args = (await cliExec.speedtest(env, "owner/workspace", "10s"))
				.trim()
				.split("\n");
			expect(args).toEqual([
				"--url",
				"http://localhost:3000",
				"--header-command",
				quoteCommand("my-header-cmd"),
				"speedtest",
				"owner/workspace",
				"--output",
				"json",
				"-t",
				"10s",
			]);
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

		it("forwards CODER_URL and CODER_SESSION_TOKEN to the child", async () => {
			const code = [
				`process.stdout.write(JSON.stringify({`,
				`  url: process.env.CODER_URL || "",`,
				`  token: process.env.CODER_SESSION_TOKEN || "",`,
				`}));`,
			].join("\n");
			const bin = await writeExecutable(tmp, "speedtest-env", code);
			const { env } = setup({ mode: "global-config", configDir: "/tmp" }, bin);
			env.authEnv = { url: "http://localhost:3000", token: "secret-token" };
			const out = await cliExec.speedtest(env, "owner/workspace");
			expect(JSON.parse(out)).toEqual({
				url: "http://localhost:3000",
				token: "secret-token",
			});
		});

		it("forwards an empty CODER_SESSION_TOKEN for mTLS", async () => {
			const code = [
				`process.stdout.write(JSON.stringify({`,
				`  url: process.env.CODER_URL,`,
				`  token: process.env.CODER_SESSION_TOKEN,`,
				`}));`,
			].join("\n");
			const bin = await writeExecutable(tmp, "speedtest-env-mtls", code);
			const { env } = setup({ mode: "global-config", configDir: "/tmp" }, bin);
			env.authEnv = { url: "http://localhost:3000", token: "" };
			const out = await cliExec.speedtest(env, "owner/workspace");
			expect(JSON.parse(out)).toEqual({
				url: "http://localhost:3000",
				token: "",
			});
		});
	});

	describe("supportBundle", () => {
		it("passes global, header, and command-specific flags", async () => {
			// Use a binary that writes args to the --output-file path
			// so we can verify them after the void-returning function completes.
			const code = [
				`const args = process.argv.slice(2);`,
				`const idx = args.indexOf("--output-file");`,
				`if (idx !== -1) { require("fs").writeFileSync(args[idx+1], args.join("\\n")); }`,
			].join("\n");
			const bin = await writeExecutable(tmp, "sb-echo-args", code);
			const outputPath = path.join(tmp, "sb-args-output.zip");
			const { configs, env } = setup(
				{ mode: "url", url: "http://localhost:3000" },
				bin,
			);
			configs.set("coder.headerCommand", "my-header-cmd");
			await cliExec.supportBundle(env, "owner/workspace", outputPath);
			const args = (await fs.readFile(outputPath, "utf-8")).trim().split("\n");
			expect(args).toEqual([
				"--url",
				"http://localhost:3000",
				"--header-command",
				quoteCommand("my-header-cmd"),
				"support",
				"bundle",
				"owner/workspace",
				"--output-file",
				outputPath,
				"--yes",
			]);
		});

		it("surfaces stderr on failure", async () => {
			const code = [
				`process.stderr.write("workspace not found\\n");`,
				`process.exitCode = 1;`,
			].join("\n");
			const bin = await writeExecutable(tmp, "sb-err", code);
			const { env } = setup({ mode: "global-config", configDir: "/tmp" }, bin);
			await expect(
				cliExec.supportBundle(env, "owner/workspace", "/tmp/bundle.zip"),
			).rejects.toThrow("workspace not found");
		});
	});
});
