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

	it("uses the active environment value verbatim", async () => {
		const { resolve } = setup();
		useActiveServerDataPath("$HOME/relative/.vscode-server");

		await expect(resolve()).resolves.toEqual({
			value: "$HOME/relative/.vscode-server",
			style: "posix",
		});
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

	it("falls back to the home default when the active environment throws", async () => {
		const { resolve } = setup();
		vi.mocked(vscode.workspace.getRemoteExecServer).mockRejectedValue(
			new Error("resolver unavailable"),
		);

		await expect(resolve()).resolves.toEqual({
			value: "~/.vscode-server",
			style: "posix",
		});
	});

	it("falls back to the home default without a remote authority", async () => {
		const { resolve } = setup();

		await expect(resolve({ remoteAuthority: undefined })).resolves.toEqual({
			value: "~/.vscode-server",
			style: "posix",
		});
	});

	it("defaults the home fallback folder to .vscode-remote", async () => {
		const { resolve } = setup();

		await expect(
			resolve({ remoteAuthority: undefined, serverDataFolderName: undefined }),
		).resolves.toEqual({ value: "~/.vscode-remote", style: "posix" });
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

		await expect(resolve()).resolves.toEqual({
			value: "~/.vscode-server",
			style: "posix",
		});
	});

	it("uses a configured path verbatim", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("ms-vscode-remote.remote-ssh");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "$HOME/relative/editor" },
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "$HOME/relative/editor/.vscode-server",
			style: "posix",
		});
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
	});
});

describe("toRemoteLogGlobs", () => {
	it.each([
		[
			{ value: "/srv/vscode", style: "posix" as const },
			[
				"/srv/vscode/data/logs/**/*.log",
				"/srv/vscode/.*.log",
				"/srv/vscode/cli/servers/*/log.txt",
			],
		],
		[
			{
				value: "C:\\Users\\coder\\.vscode-server",
				style: "win32" as const,
			},
			[
				"C:/Users/coder/.vscode-server/data/logs/**/*.log",
				"C:/Users/coder/.vscode-server/.*.log",
				"C:/Users/coder/.vscode-server/cli/servers/*/log.txt",
			],
		],
	])("appends the log globs to $value", (serverDataPath, expected) => {
		expect(toRemoteLogGlobs(serverDataPath)).toEqual(expected);
	});

	it("escapes glob metacharacters in the base path", () => {
		expect(
			toRemoteLogGlobs({ value: "/srv/{v}[1]/vs*co?de", style: "posix" }),
		).toEqual([
			"/srv/[{]v}[[]1]/vs[*]co[?]de/data/logs/**/*.log",
			"/srv/[{]v}[[]1]/vs[*]co[?]de/.*.log",
			"/srv/[{]v}[[]1]/vs[*]co[?]de/cli/servers/*/log.txt",
		]);
	});
});
