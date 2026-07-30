import { vol } from "memfs";
import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	getRemoteServerDataPath,
	toRemoteLogGlobs,
} from "@/supportBundle/remoteServerDataPath";

import { config, createMockLogger } from "../../mocks/testHelpers";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const sshHost = "coder-vscode.example--owner--workspace.agent";
const remoteAuthority = `ssh-remote+${sshHost}`;
const appRoot = "/app";
const productPath = `${appRoot}/product.json`;

type ResolveOptions = Parameters<typeof getRemoteServerDataPath>[0];

function setup() {
	vi.mocked(vscode.extensions.getExtension).mockReset();
	setRemoteSshConfiguration({});
	vol.reset();
	writeProduct(".vscode-server");
	const logger = createMockLogger();
	const resolve = (overrides: Partial<ResolveOptions> = {}) =>
		getRemoteServerDataPath({
			appRoot,
			remoteAuthority,
			logger,
			...overrides,
		});
	return { logger, resolve };
}

function writeProduct(serverDataFolderName: unknown): void {
	vol.fromJSON({
		[productPath]: JSON.stringify({ serverDataFolderName }),
	});
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

describe("getRemoteServerDataPath", () => {
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

	it("falls back to the home default when nothing is configured", async () => {
		const { resolve } = setup();

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

	it.each([undefined, null, 42, ""])(
		"defaults the folder to .vscode-remote for invalid product values: %j",
		async (value) => {
			const { resolve } = setup();
			writeProduct(value);

			await expect(resolve()).resolves.toEqual({
				value: "~/.vscode-remote",
				style: "posix",
			});
		},
	);

	it("uses the default folder when product metadata is unavailable", async () => {
		const { resolve } = setup();
		vol.reset();

		await expect(resolve()).resolves.toEqual({
			value: "~/.vscode-remote",
			style: "posix",
		});
	});

	it("uses the default folder when product metadata is invalid JSON", async () => {
		const { resolve } = setup();
		vol.fromJSON({ [productPath]: "not-json" });

		await expect(resolve()).resolves.toEqual({
			value: "~/.vscode-remote",
			style: "posix",
		});
	});

	it("does not duplicate Cursor's product folder", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("anysphere.remote-ssh");
		writeProduct(".cursor-server");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "/srv/editor/.cursor-server" },
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "/srv/editor/.cursor-server",
			style: "posix",
		});
	});

	it("anchors a relative configured path to the home directory", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("ms-vscode-remote.remote-ssh");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "editor/base" },
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "~/editor/base/.vscode-server",
			style: "posix",
		});
	});

	it("anchors a relative path before stripping Cursor's product folder", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("anysphere.remote-ssh");
		writeProduct(".cursor-server");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "editor/.cursor-server" },
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "~/editor/.cursor-server",
			style: "posix",
		});
	});

	it("anchors a relative Windows path to the home directory", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("ms-vscode-remote.remote-ssh");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "editor\\base" },
			remotePlatforms: { [sshHost]: "windows" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "~\\editor\\base\\.vscode-server",
			style: "win32",
		});
	});

	it("anchors Open Remote SSH's relative path to the home directory", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("jeanp413.open-remote-ssh");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "data" },
			remotePlatforms: { [sshHost]: "linux" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "~/data",
			style: "posix",
		});
	});

	it("uses an environment-variable path verbatim", async () => {
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

	it("prefers the configured platform over path inference", async () => {
		const { resolve } = setup();
		useRemoteSshExtension("ms-vscode-remote.remote-ssh");
		setRemoteSshConfiguration({
			installPaths: { [sshHost]: "/srv/editor" },
			remotePlatforms: { [sshHost]: "windows" },
		});

		await expect(resolve()).resolves.toEqual({
			value: "\\srv\\editor\\.vscode-server",
			style: "win32",
		});
	});

	it("falls back to the home default for an invalid authority", async () => {
		const { resolve } = setup();

		await expect(
			resolve({ remoteAuthority: "ssh-remote+coder-vscode.broken" }),
		).resolves.toEqual({ value: "~/.vscode-server", style: "posix" });
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

	describe("logging", () => {
		it("warns when the authority is invalid", async () => {
			const { logger, resolve } = setup();

			await resolve({ remoteAuthority: "ssh-remote+coder-vscode.broken" });

			expect(logger.warn).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Error),
			);
		});

		it("warns when product metadata is unavailable", async () => {
			const { logger, resolve } = setup();
			vol.reset();

			await resolve();

			expect(logger.warn).toHaveBeenCalledWith(
				expect.any(String),
				expect.anything(),
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
