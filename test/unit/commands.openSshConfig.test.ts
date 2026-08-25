import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { PathResolver } from "@/core/pathResolver";

import {
	createTestCommands,
	MockConfigurationProvider,
	useEditor,
} from "../mocks/testHelpers";

const pathResolver = new PathResolver("/data", "/logs");
const configPath = (editorId: string) =>
	pathResolver.getSshConfigPath("dev.coder.com", editorId);
const CURSOR_FILE = "cursor--dev.coder.com.conf";
const LEGACY_FILE = "vscode--dev.coder.com.conf";

vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
	readdir: vi.fn(),
}));

/** Open the generated config with the given files on disk, and report the path. */
async function openSshConfig(
	files: string[],
	remoteAuthority?: string,
): Promise<string | undefined> {
	new MockConfigurationProvider();
	const { readdir } = await import("node:fs/promises");
	vi.mocked(readdir).mockResolvedValue(files as never);
	vi.mocked(vscode.env).remoteAuthority = remoteAuthority;

	const opened: string[] = [];
	vi.mocked(vscode.window.showTextDocument).mockImplementation(
		(uri: unknown) => {
			opened.push((uri as vscode.Uri).fsPath);
			return Promise.resolve({} as vscode.TextEditor);
		},
	);
	const commands = createTestCommands({
		services: { getPathResolver: pathResolver },
	});
	await commands.openSshConfig();
	return opened[0];
}

describe("openSshConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useEditor("cursor");
	});

	it("opens the file serving the connected window, legacy host included", async () => {
		expect(
			await openSshConfig(
				[CURSOR_FILE, LEGACY_FILE],
				"ssh-remote+coder-vscode.dev.coder.com--foo--bar.main",
			),
		).toBe(configPath("vscode"));
	});

	it("opens the only file without asking", async () => {
		expect(await openSshConfig([LEGACY_FILE])).toBe(configPath("vscode"));
		expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
	});

	it("offers both prefixes serving one deployment", async () => {
		vi.mocked(vscode.window.showQuickPick).mockImplementation(
			(items: unknown) =>
				Promise.resolve(
					(items as Array<{ description: string }>).find(
						(item) => item.description === "coder-vscode.dev.coder.com--*",
					),
				) as never,
		);
		expect(await openSshConfig([CURSOR_FILE, LEGACY_FILE])).toBe(
			configPath("vscode"),
		);
		const [items] = vi.mocked(vscode.window.showQuickPick).mock.calls[0];
		expect(items).toHaveLength(2);
	});

	it("ignores files for prefixes this editor never connects over", async () => {
		expect(await openSshConfig(["devin--dev.coder.com.conf"])).toBeUndefined();
		expect(vscode.window.showInformationMessage).toHaveBeenCalled();
	});
});
