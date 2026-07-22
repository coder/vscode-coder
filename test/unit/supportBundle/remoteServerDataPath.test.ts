import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	getRemoteServerDataPath,
	toRemoteLogGlobs,
} from "@/supportBundle/remoteServerDataPath";

import { config, createMockLogger } from "../../mocks/testHelpers";

const sshHost = "coder-vscode.example--owner--workspace.agent";
const remoteAuthority = `ssh-remote+${sshHost}`;
const serverDataFolderName = ".vscode-server";

type ResolveOptions = Parameters<typeof getRemoteServerDataPath>[0];

function setup() {
	vi.mocked(vscode.workspace.getRemoteExecServer).mockReset();
	vi.mocked(vscode.extensions.getExtension).mockReset();
	vi.mocked(vscode.workspace.getRemoteExecServer).mockResolvedValue(undefined);
	setRemoteSshConfiguration({});
	const logger = createMockLogger();
	const resolve = (overrides: Partial<ResolveOptions> = {}) =>
		getRemoteServerDataPath({
			remoteAuthority,
			serverDataFolderName,
			logger,
			...overrides,
		});
	return { logger, resolve };
}

function useRemoteSshExtension(id: string): void {
	vi.mocked(vscode.extensions.getExtension).mockImplementation(
		(extensionId) =>
			(extensionId === id ? { id: extensionId } : undefined) as
				vscode.Extension<unknown> | undefined,
	);
}

function setRemoteSshConfiguration(options: {
	readonly installPaths?: Record<string, string>;
	readonly remotePlatforms?: Record<string, string>;
}): void {
	config({
		"remote.SSH.serverInstallPath": options.installPaths ?? {},
		"remote.SSH.remotePlatform": options.remotePlatforms ?? {},
	});
}

function useActiveServerDataPath(value: string, osPlatform = "linux"): void {
	vi.mocked(vscode.workspace.getRemoteExecServer).mockResolvedValue({
		env: vi.fn().mockResolvedValue({
			env: { VSCODE_AGENT_FOLDER: value },
			osPlatform,
		}),
	});
}

describe("getRemoteServerDataPath", () => {
	it("uses the active exec server environment", async () => {
		const { resolve } = setup();
		useActiveServerDataPath("/srv/vscode");

		await expect(resolve()).resolves.toEqual({
			value: "/srv/vscode",
			style: "posix",
		});
	});

	it("uses the active environment without product metadata", async () => {
		const { resolve } = setup();
		useActiveServerDataPath("/srv/vscode");

		await expect(resolve({ serverDataFolderName: undefined })).resolves.toEqual(
			{ value: "/srv/vscode", style: "posix" },
		);
	});

	it("uses the active environment platform for Windows paths", async () => {
		const { resolve } = setup();
		useActiveServerDataPath("C:\\Users\\coder\\.vscode-server", "win32");

		await expect(resolve()).resolves.toEqual({
			value: "C:\\Users\\coder\\.vscode-server",
			style: "win32",
		});
	});

	it("rejects an unsafe active environment path", async () => {
		const { resolve } = setup();
		useActiveServerDataPath("$HOME/.vscode-server");

		await expect(resolve()).resolves.toBeUndefined();
	});

	it.each(["ms-vscode-remote.remote-ssh", "anysphere.remote-ssh"])(
		"appends the product folder for %s",
		async (extensionId) => {
			const { resolve } = setup();
			useRemoteSshExtension(extensionId);
			setRemoteSshConfiguration({
				installPaths: { [sshHost]: "/srv/editor" },
				remotePlatforms: { [sshHost]: "linux" },
			});

			await expect(resolve()).resolves.toEqual({
				value: "/srv/editor/.vscode-server",
				style: "posix",
			});
		},
	);

	it("prefers the configured path over the active environment", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("ms-vscode-remote.remote-ssh");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "/srv/editor" },
			remotePlatforms: { [sshHost]: "linux" },
		});
		useActiveServerDataPath("/srv/active");

		await expect(resolve()).resolves.toEqual({
			value: "/srv/editor/.vscode-server",
			style: "posix",
		});
	});

	it("returns undefined when resolving the active environment throws", async () => {
		const { resolve } = setup();
		vi.mocked(vscode.workspace.getRemoteExecServer).mockRejectedValue(
			new Error("resolver unavailable"),
		);

		await expect(resolve()).resolves.toBeUndefined();
	});

	it("does not duplicate Cursor's product folder", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("anysphere.remote-ssh");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "/srv/editor/.cursor-server" },
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(
			resolve({ serverDataFolderName: ".cursor-server" }),
		).resolves.toEqual({ value: "/srv/editor/.cursor-server", style: "posix" });
	});

	it("uses the configured remote platform for Windows paths", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("ms-vscode-remote.remote-ssh");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "C:\\Users\\coder\\editor" },
			remotePlatforms: { [sshHost]: "windows" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "C:\\Users\\coder\\editor\\.vscode-server",
			style: "win32",
		});
	});

	it("infers Windows only from an unambiguous configured path", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("ms-vscode-remote.remote-ssh");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "C:\\Users\\coder\\editor" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "C:\\Users\\coder\\editor\\.vscode-server",
			style: "win32",
		});
	});

	it("uses Open Remote SSH's most specific matching path as the final folder", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("jeanp413.open-remote-ssh");
		setRemoteSshConfiguration({
			installPaths: {
				"*": "/srv/default",
				"coder-vscode.*": "/srv/coder",
				[sshHost]: "/srv/exact",
			},
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "/srv/exact",
			style: "posix",
		});
	});

	it("prefers a specific wildcard over the catch-all for Open Remote SSH", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("jeanp413.open-remote-ssh");
		setRemoteSshConfiguration({
			installPaths: {
				"*": "/srv/default",
				"coder-vscode.*": "/srv/coder",
			},
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "/srv/coder",
			style: "posix",
		});
	});

	it("treats ? as a literal character in Open Remote SSH patterns", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("jeanp413.open-remote-ssh");
		setRemoteSshConfiguration({
			installPaths: {
				"*": "/srv/default",
				"coder-vscode.?xample--owner--workspace.agent": "/srv/question",
			},
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "/srv/default",
			style: "posix",
		});
	});

	it.each([
		"codeium.windsurf-remote-openssh",
		"google.antigravity-remote-openssh",
	])("ignores serverInstallPath for %s", async (extensionId) => {
		const { resolve } = setup();
		useRemoteSshExtension(extensionId);
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "/srv/editor" },
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(resolve()).resolves.toBeUndefined();
	});

	it.each([
		"relative/editor",
		"$HOME/editor",
		"/srv/*/editor",
		"/srv/../editor",
	])("rejects an unsafe configured path: %s", async (installPath) => {
		const { resolve } = setup();
		useRemoteSshExtension("ms-vscode-remote.remote-ssh");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: installPath },
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(resolve()).resolves.toBeUndefined();
	});

	describe("logging", () => {
		it("warns when resolving the active environment throws", async () => {
			const { logger, resolve } = setup();
			vi.mocked(vscode.workspace.getRemoteExecServer).mockRejectedValue(
				new Error("resolver unavailable"),
			);

			await resolve();

			expect(logger.warn).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Error),
			);
		});

		it("warns when a configured path is rejected as unsafe", async () => {
			const { logger, resolve } = setup();
			useRemoteSshExtension("ms-vscode-remote.remote-ssh");
			setRemoteSshConfiguration({
				installPaths: { [sshHost]: "$HOME/editor" },
				remotePlatforms: { [sshHost]: "linux" },
			});

			await resolve();

			expect(logger.warn).toHaveBeenCalledWith(expect.any(String));
		});
	});
});

describe("toRemoteLogGlobs", () => {
	it.each([
		[
			{ value: "/srv/vscode", style: "posix" as const },
			["/srv/vscode/data/logs/**/*.log"],
		],
		[
			{
				value: "C:\\Users\\coder\\.vscode-server",
				style: "win32" as const,
			},
			["C:/Users/coder/.vscode-server/data/logs/**/*.log"],
		],
	])("appends the log globs to $value", (serverDataPath, expected) => {
		expect(toRemoteLogGlobs(serverDataPath)).toEqual(expected);
	});
});
