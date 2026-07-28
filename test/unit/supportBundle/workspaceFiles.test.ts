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
	vi.mocked(getRemoteServerDataPath).mockResolvedValue({
		value: "/srv/vscode",
		style: "posix",
	});
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
	it("returns log globs for the resolved server data path", async () => {
		const { logger, collect } = setup();
		writeProduct(".vscode-server");

		await expect(collect({ remoteAuthority })).resolves.toEqual(
			resolvedLogFiles,
		);
		expect(getRemoteServerDataPath).toHaveBeenCalledWith({
			remoteAuthority,
			serverDataFolderName: ".vscode-server",
			logger,
		});
	});

	it("passes any non-empty folder name through", async () => {
		const { collect } = setup();
		writeProduct("nested/$HOME/*server");

		await collect();

		expect(getRemoteServerDataPath).toHaveBeenCalledWith(
			expect.objectContaining({ serverDataFolderName: "nested/$HOME/*server" }),
		);
	});

	it.each([undefined, null, 42, ""])(
		"resolves without a folder name for invalid product values: %j",
		async (value) => {
			const { collect } = setup();
			writeProduct(value);

			await expect(collect()).resolves.toEqual(resolvedLogFiles);
			expect(getRemoteServerDataPath).toHaveBeenCalledWith(
				expect.objectContaining({ serverDataFolderName: undefined }),
			);
		},
	);

	it("resolves without a folder name when product metadata is unavailable", async () => {
		const { logger, collect } = setup();

		await expect(collect()).resolves.toEqual(resolvedLogFiles);
		expect(getRemoteServerDataPath).toHaveBeenCalledWith(
			expect.objectContaining({ serverDataFolderName: undefined }),
		);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.any(String),
			expect.anything(),
		);
	});

	it("resolves without a folder name when product metadata is invalid JSON", async () => {
		const { collect } = setup();
		vol.fromJSON({ [productPath]: "not-json" });

		await expect(collect()).resolves.toEqual(resolvedLogFiles);
		expect(getRemoteServerDataPath).toHaveBeenCalledWith(
			expect.objectContaining({ serverDataFolderName: undefined }),
		);
	});
});
