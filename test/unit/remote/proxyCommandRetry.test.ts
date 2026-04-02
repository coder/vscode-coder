import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureRetryScript } from "@/remote/proxyCommandRetry";

import { createMockLogger } from "../../mocks/testHelpers";
import { isWindows } from "../../utils/platform";

const execFileAsync = promisify(execFile);

/** Run the retry script with fast defaults (0s sleep). */
function run(
	script: string,
	args: string[],
	env: Record<string, string> = {},
	timeout?: number,
) {
	return execFileAsync(script, args, {
		timeout,
		env: {
			...process.env,
			CODER_RETRY_SLEEP: "0",
			CODER_RETRY_MAX_RETRIES: "10",
			CODER_RETRY_MIN_RUNTIME: "10",
			...env,
		},
	});
}

describe.skipIf(isWindows())("proxyCommandRetry", () => {
	let tmpDir: string;
	let script: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "coder-retry-test-"));
		script = await ensureRetryScript(tmpDir, createMockLogger());
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("passes through on success", async () => {
		const { stdout } = await run(script, ["echo", "hello"]);
		expect(stdout.trim()).toBe("hello");
	});

	it("retries on quick failure then succeeds", async () => {
		// Fails until marker file exists, then succeeds.
		const marker = path.join(tmpDir, "marker");
		const helper = path.join(tmpDir, "h.sh");
		await fs.writeFile(
			helper,
			`#!/bin/sh\n[ -f "${marker}" ] && echo ok && exit 0\ntouch "${marker}"\nexit 1\n`,
			{ mode: 0o755 },
		);

		const { stdout } = await run(script, [helper]);
		expect(stdout.trim()).toBe("ok");
	});

	it("gives up after max retries and logs each attempt", async () => {
		try {
			await run(script, ["sh", "-c", "exit 42"], {
				CODER_RETRY_MAX_RETRIES: "3",
			});
			expect.fail("should have thrown");
		} catch (err: unknown) {
			const e = err as { code: number; stderr: string };
			expect(e.code).toBe(42);
			expect(e.stderr).toContain("attempt 1/3 failed");
			expect(e.stderr).toContain("attempt 3/3 failed");
		}
	});

	it("skips retry when command ran longer than min runtime", async () => {
		const marker = path.join(tmpDir, "ran");
		const helper = path.join(tmpDir, "slow.sh");
		await fs.writeFile(
			helper,
			`#!/bin/sh\n[ -f "${marker}" ] && exit 99\ntouch "${marker}"\nsleep 2\nexit 1\n`,
			{ mode: 0o755 },
		);

		try {
			await run(script, [helper], { CODER_RETRY_MIN_RUNTIME: "1" }, 10000);
			expect.fail("should have thrown");
		} catch (err: unknown) {
			// Exit code 1 (not 99) proves it ran once and didn't retry.
			expect((err as { code: number }).code).toBe(1);
		}
	});

	it("preserves arguments with spaces", async () => {
		const { stdout } = await run(script, [
			"sh",
			"-c",
			'echo "$1 $2"',
			"--",
			"hello world",
			"it's fine",
		]);
		expect(stdout.trim()).toBe("hello world it's fine");
	});
});
