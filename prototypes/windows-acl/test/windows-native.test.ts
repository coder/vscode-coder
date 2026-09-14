import { execFile as execFileCallback } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import bridgeModule from "../bridge.cjs";

const { createBridge } = bridgeModule;
const execFile = promisify(execFileCallback);
const artifactRoot = path.resolve(import.meta.dirname, "..");
const arch =
	process.arch === "arm64"
		? "arm64"
		: process.arch === "x64"
			? "x64"
			: undefined;
const nativeArtifactsAvailable =
	process.platform === "win32" &&
	arch !== undefined &&
	["acl-helper.exe", "acl.node"].every((name) =>
		require("node:fs").existsSync(
			path.join(artifactRoot, "artifacts", `win32-${arch}`, name),
		),
	);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), "windows-acl-native-"),
	);
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

describe.runIf(nativeArtifactsAvailable)(
	"staged Windows ACL implementations",
	() => {
		it("apply equivalent protected ACLs repeatedly and retain OpenSSH Include support", async () => {
			const directory = await temporaryDirectory();
			const parentConfig = path.join(directory, "parent.conf");
			const includedConfig = path.join(directory, "included.conf");
			await fs.writeFile(
				parentConfig,
				"Host acl-prototype\n  User prototype-user\n",
			);
			await fs.writeFile(
				includedConfig,
				"Include parent.conf\nHost *\n  Compression no\n",
			);

			// The disposable file starts permissive so both implementations must replace it.
			await execFile("icacls", [includedConfig, "/grant", "*S-1-1-0:(F)"]);

			const bridges = ["helper", "addon"] as const;
			const inspected = await Promise.all(
				bridges.map(async (variant) => {
					const bridge = createBridge({
						variant,
						artifactRoot,
						platform: "win32",
						arch,
					});
					await bridge.secure(includedConfig);
					const first = await bridge.inspect(includedConfig);
					await bridge.secure(includedConfig);
					const second = await bridge.inspect(includedConfig);
					expect(second).toBe(first);
					const { stdout } = await execFile("ssh", [
						"-G",
						"-F",
						includedConfig,
						"acl-prototype",
					]);
					expect(stdout).toContain("user prototype-user");
					return first;
				}),
			);

			expect(inspected[0]).toBe(inspected[1]);
		});
	},
);
