import { execFile as execFileCallback } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import bridgeModule from "../bridge.cjs";

const { createBridge } = bridgeModule;
const execFile = promisify(execFileCallback);
const artifactRoot = path.resolve(import.meta.dirname, "..", "artifacts");
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

// A Windows run must fail, not skip, when native artifacts or OpenSSH are absent.
// Select Windows' OpenSSH explicitly rather than a Git/MSYS ssh from PATH.
describe.runIf(process.platform === "win32")(
	"staged Windows ACL implementations",
	() => {
		it("repair an included file and preserve the policy through an atomic rewrite", async () => {
			const root = await fs.mkdtemp(
				path.join(os.tmpdir(), "windows-acl-native-"),
			);
			temporaryDirectories.push(root);
			const systemRoot = process.env.SystemRoot;
			if (!systemRoot)
				throw new Error("SystemRoot is required for Windows tests");
			const ssh = path.join(systemRoot, "System32", "OpenSSH", "ssh.exe");
			const icacls = path.join(systemRoot, "System32", "icacls.exe");
			const descriptors: string[] = [];
			for (const variant of ["helper", "addon"] as const) {
				const directory = path.join(root, variant);
				await fs.mkdir(directory);
				const parentConfig = path.join(directory, "parent.conf");
				const includedConfig = path.join(directory, "included.conf");
				await fs.writeFile(
					parentConfig,
					`Include "${includedConfig.replaceAll("\\", "/")}"\n`,
				);
				await fs.writeFile(
					includedConfig,
					"Host acl-prototype\n  User prototype-user\n",
				);
				const args = ["-G", "-F", parentConfig, "acl-prototype"];
				// icacls is only fixture setup; neither native implementation depends on it.
				await execFile(icacls, [includedConfig, "/grant", "*S-1-1-0:(F)"]);
				await expect(execFile(ssh, args)).rejects.toMatchObject({
					stderr: expect.stringMatching(/Bad owner or permissions/),
				});
				const bridge = createBridge({ variant, artifactRoot });
				await bridge.secure(directory);
				await bridge.secure(includedConfig);
				const first = await bridge.inspect(includedConfig);
				if (typeof first !== "string") {
					throw new Error("Windows ACL inspection unexpectedly skipped");
				}
				expect(first).toContain("D:P");
				await bridge.secure(includedConfig);
				expect(await bridge.inspect(includedConfig)).toBe(first);
				descriptors.push(first);
				expect((await execFile(ssh, args)).stdout).toContain(
					"user prototype-user",
				);
				const replacement = path.join(directory, "replacement.tmp");
				await fs.writeFile(
					replacement,
					"Host acl-prototype\n  User rewritten-user\n",
					{ flag: "wx" },
				);
				await bridge.secure(replacement);
				await fs.rename(replacement, includedConfig);
				expect(await bridge.inspect(includedConfig)).toBe(first);
				expect((await execFile(ssh, args)).stdout).toContain(
					"user rewritten-user",
				);
			}
			expect(descriptors[0]).toBe(descriptors[1]);
		}, 60_000);
	},
);
