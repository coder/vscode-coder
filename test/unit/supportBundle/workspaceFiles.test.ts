import { vol } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { getRemoteServerDataPath } from "@/supportBundle/remoteServerDataPath";
import { getRemoteEditorLogGlobs } from "@/supportBundle/workspaceFiles";

import { createMockLogger } from "../../mocks/testHelpers";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("@/supportBundle/remoteServerDataPath", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("@/supportBundle/remoteServerDataPath")
		>();
	return {
		...original,
		getRemoteServerDataPath: vi.fn(),
	};
});

const appRoot = "/app";
const productPath = `${appRoot}/product.json`;
const remoteAuthority =
	"ssh-remote+coder-vscode.example--owner--workspace.agent";
const resolvedLogFiles = [
	"/srv/vscode/data/logs/**/*.log",
	"/srv/vscode/.*.log",
	"/srv/vscode/cli/servers/*/log.txt",
];

function setup() {
	vol.reset();
	vi.mocked(getRemoteServerDataPath).mockReset();
	vi.mocked(getRemoteServerDataPath).mockResolvedValue(undefined);
	const logger = createMockLogger();
	const collect = (overrides: { remoteAuthority?: string } = {}) =>
		getRemoteEditorLogGlobs({ appRoot, logger, ...overrides });
	return { logger, collect };
}

function writeProduct(serverDataFolderName: unknown): void {
	vol.fromJSON({
		[productPath]: JSON.stringify({ serverDataFolderName }),
	});
}

describe("getRemoteEditorLogGlobs", () => {
	it.each([
		".vscode-server",
		".vscode-server-insiders",
		".cursor-server",
		".windsurf-server",
		".antigravity-server",
	])("derives the product fallback for %s", async (serverDataFolderName) => {
		const { collect } = setup();
		writeProduct(serverDataFolderName);

		await expect(collect()).resolves.toEqual([
			`~/${serverDataFolderName}/data/logs/**/*.log`,
			`~/${serverDataFolderName}/.*.log`,
			`~/${serverDataFolderName}/cli/servers/*/log.txt`,
		]);
	});

	it("uses the resolved remote server path", async () => {
		const { logger, collect } = setup();
		writeProduct(".vscode-server");
		vi.mocked(getRemoteServerDataPath).mockResolvedValue({
			value: "/srv/vscode",
			style: "posix",
		});

		await expect(collect({ remoteAuthority })).resolves.toEqual(
			resolvedLogFiles,
		);
		expect(getRemoteServerDataPath).toHaveBeenCalledWith({
			remoteAuthority,
			serverDataFolderName: ".vscode-server",
			logger,
		});
	});

	it.each([
		undefined,
		null,
		42,
		"",
		".",
		"..",
		"../.vscode-server",
		"nested/.vscode-server",
		"nested\\.vscode-server",
		"/home/coder/.vscode-server",
		"*",
		"wild*card",
		"?server",
		"[ab]server",
		"$HOME",
	])("rejects unsafe server data folder names: %j", async (value) => {
		const { collect } = setup();
		writeProduct(value);

		await expect(collect()).resolves.toEqual([]);
	});

	it("uses the active server path without product metadata", async () => {
		const { logger, collect } = setup();
		vi.mocked(getRemoteServerDataPath).mockResolvedValue({
			value: "/srv/vscode",
			style: "posix",
		});

		await expect(collect({ remoteAuthority })).resolves.toEqual(
			resolvedLogFiles,
		);
		expect(getRemoteServerDataPath).toHaveBeenCalledWith({
			remoteAuthority,
			serverDataFolderName: undefined,
			logger,
		});
	});

	it("returns no paths when product metadata is unavailable", async () => {
		const { collect } = setup();

		await expect(collect()).resolves.toEqual([]);
	});

	it("uses the active server path when product metadata is invalid", async () => {
		const { collect } = setup();
		vol.fromJSON({ [productPath]: "not-json" });
		vi.mocked(getRemoteServerDataPath).mockResolvedValue({
			value: "/srv/vscode",
			style: "posix",
		});

		await expect(collect({ remoteAuthority })).resolves.toEqual(
			resolvedLogFiles,
		);
	});

	it("returns no paths when product metadata is invalid JSON", async () => {
		const { collect } = setup();
		vol.fromJSON({ [productPath]: "not-json" });

		await expect(collect()).resolves.toEqual([]);
	});
});
