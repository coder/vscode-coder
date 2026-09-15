import { vol } from "memfs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
	createManagedSshConfig,
	ManagedSshConfig,
} from "@/remote/managedSshConfig";
import { SshConfig, type FileSystem, type SshValues } from "@/remote/sshConfig";
import { WindowsAcl } from "@/remote/windowsAcl";

import { createMockLogger } from "../../mocks/testHelpers";

import type { Logger } from "@/logging/logger";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const configDir = "/home/coder/.ssh/coder";
const configPath = path.join(configDir, "deployment.conf");
const scriptPath = "/extension/scripts/windows-acl.js";
const values = {
	Host: "coder-vscode.example--*",
	ProxyCommand: "coder ssh %h",
	ConnectTimeout: "0",
	StrictHostKeyChecking: "no",
	UserKnownHostsFile: "/dev/null",
	LogLevel: "ERROR",
	ServerAliveInterval: "10",
	ServerAliveCountMax: "3",
} as const satisfies SshValues;

interface Fixture {
	logger: Logger;
	warnings: Array<{ message: string; args: unknown[] }>;
	attemptedPaths: string[];
	createConfig: (fileSystem?: FileSystem) => ManagedSshConfig;
}

const test = it
	.extend("fixture", ({ task: _task }, { onCleanup }): Fixture => {
		vol.reset();
		const logger = createMockLogger();
		const warnings: Fixture["warnings"] = [];
		vi.mocked(logger.warn).mockImplementation((message, ...args) => {
			warnings.push({ message, args });
		});
		const attemptedPaths: string[] = [];
		vi.spyOn(WindowsAcl.prototype, "secure").mockImplementation((filePath) => {
			attemptedPaths.push(filePath);
			return Promise.resolve();
		});
		onCleanup(() => {
			vi.restoreAllMocks();
			vol.reset();
		});
		return {
			logger,
			warnings,
			attemptedPaths,
			createConfig: (fileSystem = fsPromises) =>
				new ManagedSshConfig(
					configPath,
					logger,
					new WindowsAcl(scriptPath),
					fileSystem,
				),
		};
	})
	.extend("factory", ({ task: _task }, { onCleanup }) => {
		const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
		onCleanup(() => {
			if (descriptor) Object.defineProperty(process, "platform", descriptor);
		});
		return {
			setPlatform(platform: NodeJS.Platform) {
				Object.defineProperty(process, "platform", { value: platform });
			},
		};
	});

describe("ManagedSshConfig", () => {
	test("repairs regular .conf siblings and the populated temporary file before replacement", async ({
		fixture,
	}) => {
		const sibling = path.join(configDir, "other.CONF");
		vol.fromJSON({
			[configPath]: "Host original",
			[sibling]: "Host sibling",
			[path.join(configDir, "ignored.txt")]: "ignored",
		});
		const snapshots: Array<{ filePath: string; contents: string }> = [];
		vi.mocked(WindowsAcl.prototype.secure).mockImplementation(
			async (filePath) => {
				fixture.attemptedPaths.push(filePath);
				snapshots.push({
					filePath,
					contents: await fsPromises.readFile(filePath, "utf-8"),
				});
			},
		);

		await fixture.createConfig().update(values);

		expect(snapshots).toEqual([
			{ filePath: configPath, contents: "Host original" },
			{ filePath: sibling, contents: "Host sibling" },
			{
				filePath: expect.stringContaining(".deployment.conf.vscode-coder-tmp-"),
				contents: expect.stringContaining("ProxyCommand coder ssh %h"),
			},
		]);
		expect(await fsPromises.readFile(configPath, "utf-8")).toContain(
			"ProxyCommand coder ssh %h",
		);
	});

	test("warns and attempts later files after each repair failure", async ({
		fixture,
	}) => {
		const failingSibling = path.join(configDir, "failing.conf");
		const laterSibling = path.join(configDir, "later.conf");
		vol.fromJSON({
			[configPath]: "Host original",
			[failingSibling]: "Host failing",
			[laterSibling]: "Host later",
		});
		const failure = new Error("permission repair failed");
		vi.mocked(WindowsAcl.prototype.secure).mockImplementation((filePath) => {
			fixture.attemptedPaths.push(filePath);
			return filePath === failingSibling ||
				filePath.includes("vscode-coder-tmp")
				? Promise.reject(failure)
				: Promise.resolve();
		});

		await fixture.createConfig().update(values);

		expect(fixture.attemptedPaths).toEqual([
			configPath,
			failingSibling,
			laterSibling,
			expect.stringContaining(".deployment.conf.vscode-coder-tmp-"),
		]);
		expect(fixture.warnings).toEqual([
			{
				message: "Failed to repair SSH config permissions",
				args: [failingSibling, failure],
			},
			{
				message: "Failed to repair SSH config permissions",
				args: [
					expect.stringContaining(".deployment.conf.vscode-coder-tmp-"),
					failure,
				],
			},
		]);
		expect(await fsPromises.readFile(configPath, "utf-8")).toContain(
			"ProxyCommand coder ssh %h",
		);
	});

	test("warns and leaves non-regular .conf entries untouched", async ({
		fixture,
	}) => {
		const directory = path.join(configDir, "directory.conf");
		vol.fromJSON({ [configPath]: "Host original", [directory]: null });

		await fixture.createConfig().update(values);

		expect(fixture.attemptedPaths).not.toContain(directory);
		expect(fixture.warnings).toContainEqual({
			message: "Skipping non-regular Coder-managed SSH config entry",
			args: [directory],
		});
		expect(vol.statSync(directory).isDirectory()).toBe(true);
	});

	test("continues writing when sibling enumeration fails", async ({
		fixture,
	}) => {
		const error = new Error("cannot enumerate");
		vi.spyOn(fsPromises, "readdir").mockRejectedValueOnce(error);

		await fixture.createConfig().update(values);

		expect(fixture.warnings).toContainEqual({
			message: "Failed to enumerate Coder-managed SSH config files",
			args: [error],
		});
		expect(await fsPromises.readFile(configPath, "utf-8")).toContain(
			"ProxyCommand coder ssh %h",
		);
	});
});

describe("createManagedSshConfig", () => {
	test("returns the plain config off Windows without scanning sibling files", async ({
		fixture,
		factory,
	}) => {
		factory.setPlatform("linux");
		const inaccessibleSibling = path.join(configDir, "inaccessible.conf");
		vol.fromJSON({ [inaccessibleSibling]: "Host sibling" });
		vi.spyOn(fsPromises, "readdir").mockRejectedValue(
			new Error("should not scan"),
		);
		const config = createManagedSshConfig(
			configPath,
			fixture.logger,
			scriptPath,
		);

		expect(config).toBeInstanceOf(SshConfig);
		expect(config).not.toBeInstanceOf(ManagedSshConfig);
		await config.update(values);

		expect(fixture.attemptedPaths).toEqual([]);
		expect(await fsPromises.readFile(configPath, "utf-8")).toContain(
			"ProxyCommand coder ssh %h",
		);
	});
});
