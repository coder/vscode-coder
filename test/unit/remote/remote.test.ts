import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { MementoManager } from "@/core/mementoManager";
import { PathResolver } from "@/core/pathResolver";
import { SecretsManager } from "@/core/secretsManager";
import { Remote, workspaceLabelSuffix } from "@/remote/remote";

import { createTestTelemetryService } from "../../mocks/telemetry";
import {
	createMockLogger,
	createMockServiceContainer,
	InMemoryMemento,
	InMemorySecretStorage,
	LogCollector,
	MockConfigurationProvider,
	MockUserInteraction,
	useEditor,
} from "../../mocks/testHelpers";

import type { Commands } from "@/commands";
import type { CliManager } from "@/core/cliManager";
import type { Logger } from "@/logging/logger";
import type { CliAuth } from "@/settings/cli";

const mockWorkspace = vscode.workspace as typeof vscode.workspace & {
	workspaceFile: vscode.Uri | undefined;
	workspaceFolders: vscode.WorkspaceFolder[];
};

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const SAFE_HOSTNAME = "coder.example.com";
const REMOTE_AUTHORITY =
	"ssh-remote+coder-vscode.coder.example.com--testuser--test-workspace.main";
const CURSOR_REMOTE_AUTHORITY =
	"ssh-remote+coder-cursor.coder.example.com--testuser--test-workspace.main";
const DEVIN_REMOTE_AUTHORITY =
	"ssh-remote+coder-devin.coder.example.com--testuser--test-workspace.main";
const REMOTE_SSH_EXTENSION_ID = "anysphere.remote-ssh";
const MISMATCHED_URL =
	"https://cursor.example.com/private?token=sensitive-url-token";
const SESSION_TOKEN = "sensitive-session-token";
const CLI_AUTH: CliAuth = {
	store: "extension",
	url: "https://coder.example.com",
	configDir: "/mock/global",
	useKeyring: undefined,
	allowRedirects: false,
};

function createRemote(logger: Logger = createMockLogger()) {
	const config = new MockConfigurationProvider();
	const userInteraction = new MockUserInteraction();
	const pathResolver = new PathResolver("/mock/global", "/mock/log");
	vol.fromJSON({
		[pathResolver.getUrlPath(SAFE_HOSTNAME)]: MISMATCHED_URL,
		[pathResolver.getSessionTokenPath(SAFE_HOSTNAME)]: SESSION_TOKEN,
	});
	const secretsManager = new SecretsManager(
		new InMemorySecretStorage(),
		new MementoManager(new InMemoryMemento()),
		logger,
	);
	const ensureLoggedInWithDialog = vi
		.fn()
		.mockResolvedValue({ success: false, reason: "user_dismissed" });
	const mementoManager = new MementoManager(new InMemoryMemento());
	const serviceContainer = createMockServiceContainer({
		logger,
		pathResolver,
		mementoManager,
		cliManager: {} as CliManager,
		contextManager: {
			set: vi.fn(),
			get: vi.fn(() => false),
			dispose: vi.fn(),
		},
		secretsManager,
		loginCoordinator: { ensureLoggedInWithDialog },
		telemetry: createTestTelemetryService(),
	});

	return {
		remote: new Remote(
			serviceContainer,
			{} as Commands,
			{} as vscode.ExtensionContext,
		),
		config,
		ensureLoggedInWithDialog,
		mementoManager,
		secretsManager,
		userInteraction,
	};
}

describe("Remote", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vol.reset();
		mockWorkspace.workspaceFile = undefined;
		mockWorkspace.workspaceFolders = [];
	});

	type UriOptions = Partial<
		Pick<vscode.Uri, "scheme" | "authority" | "query" | "fragment">
	>;
	const createUri = (path: string, options: UriOptions = {}) =>
		vscode.Uri.from({
			scheme: options.scheme ?? "cursor-remote",
			authority: options.authority ?? REMOTE_AUTHORITY,
			path,
			query: options.query,
			fragment: options.fragment,
		});
	const setWorkspace = (
		folders: vscode.Uri[] = [],
		workspaceFile?: vscode.Uri,
	) => {
		mockWorkspace.workspaceFile = workspaceFile;
		mockWorkspace.workspaceFolders = folders.map(
			(uri) => ({ uri }) as vscode.WorkspaceFolder,
		);
		return mockWorkspace.workspaceFolders;
	};

	interface LegacyWindowCase {
		label: string;
		open: () => void;
	}
	it.each<LegacyWindowCase>([
		{ label: "a folder", open: () => setWorkspace([createUri("/workspace")]) },
		{
			label: "a saved multi-root workspace",
			open: () =>
				setWorkspace(
					[createUri("/first-folder"), createUri("/second-folder")],
					createUri("/project.code-workspace"),
				),
		},
		{
			label: "an untitled multi-root workspace",
			open: () =>
				setWorkspace(
					[createUri("/first-folder"), createUri("/second-folder")],
					createUri("/Untitled-1.code-workspace", {
						scheme: "untitled",
						authority: "",
					}),
				),
		},
		{ label: "an empty window", open: () => setWorkspace() },
	])(
		"connects $label over the legacy host without reopening it",
		async ({ open }) => {
			useEditor("cursor");
			const { remote, ensureLoggedInWithDialog, userInteraction } =
				createRemote();
			open();

			await expect(
				remote.setup(REMOTE_AUTHORITY, "none", REMOTE_SSH_EXTENSION_ID),
			).resolves.toBeUndefined();

			// Reopening would change the authority, and with it the identity the
			// editor keeps window state under.
			expect(ensureLoggedInWithDialog).toHaveBeenCalledOnce();
			expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
				"vscode.openFolder",
				expect.anything(),
				expect.anything(),
			);
			expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
				"vscode.newWindow",
				expect.anything(),
			);
			expect(
				userInteraction.getMessageCalls().find((c) => c.level === "warning"),
			).toBeUndefined();
		},
	);

	it("continues setup for the current authority without reopening", async () => {
		useEditor("cursor");
		const { remote, ensureLoggedInWithDialog } = createRemote();

		await expect(
			remote.setup(CURSOR_REMOTE_AUTHORITY, "none", REMOTE_SSH_EXTENSION_ID),
		).resolves.toBeUndefined();

		expect(ensureLoggedInWithDialog).toHaveBeenCalledOnce();
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
			"vscode.openFolder",
			expect.anything(),
			expect.anything(),
		);
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
			"vscode.newWindow",
			expect.anything(),
		);
	});

	it("ignores a foreign authority", async () => {
		useEditor("cursor");
		const { remote, ensureLoggedInWithDialog, mementoManager } = createRemote();

		await expect(
			remote.setup(DEVIN_REMOTE_AUTHORITY, "none", REMOTE_SSH_EXTENSION_ID),
		).resolves.toBeUndefined();

		expect(ensureLoggedInWithDialog).not.toHaveBeenCalled();
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		expect(await mementoManager.getAndClearStartupMode()).toBe("none");
	});

	it("ignores mismatched file auth and logs why", async () => {
		const logs = new LogCollector();
		const { remote, secretsManager } = createRemote(logs);

		await expect(
			remote.setup(REMOTE_AUTHORITY, "none", REMOTE_SSH_EXTENSION_ID),
		).resolves.toBeUndefined();

		expect(await secretsManager.getSessionAuth(SAFE_HOSTNAME)).toBeUndefined();
		// The mismatched URL carries a token, so only its hostname is logged.
		expect(logs.entries).toContainEqual({
			level: "warn",
			message: "Failed to migrate session auth from files:",
			args: [
				new Error(
					`Session auth hostname mismatch: expected "${SAFE_HOSTNAME}", got "cursor.example.com"`,
				),
			],
		});
	});

	interface RemoteInternals {
		buildProxyCommand: Remote["buildProxyCommand"];
	}

	interface SshFlagsCase {
		name: string;
		flags?: string[];
		expected: string;
	}

	/** Drops the platform-specific network info path. */
	const elideNetworkInfoDir = (command: string) =>
		command.replace(/--network-info-dir \S+/, "--network-info-dir <dir>");

	describe("ProxyCommand", () => {
		it.each<SshFlagsCase>([
			{
				name: "disables autostart by default",
				expected:
					"ssh --disable-autostart --stdio --usage-app=vscode --network-info-dir <dir> --ssh-host-prefix coder-vscode.coder.example.com-- %h",
			},
			{
				name: "passes the user's flags ahead of the managed ones",
				flags: ["--wait=yes"],
				expected:
					"ssh --wait=yes --stdio --usage-app=vscode --network-info-dir <dir> --ssh-host-prefix coder-vscode.coder.example.com-- %h",
			},
		])("$name", async ({ flags, expected }) => {
			const { remote, config } = createRemote();
			if (flags) {
				config.set("coder.sshFlags", flags);
			}

			const proxyCommand = await (
				remote as unknown as RemoteInternals
			).buildProxyCommand(
				"/mock/coder",
				SAFE_HOSTNAME,
				"coder-vscode.coder.example.com--",
				"",
				true,
				CLI_AUTH,
			);

			expect(elideNetworkInfoDir(proxyCommand)).toBe(
				`/mock/coder --global-config /mock/global --url https://coder.example.com ${expected}`,
			);
		});
	});
});

describe("workspaceLabelSuffix", () => {
	it.each([
		{
			label: "this editor's",
			editor: "cursor",
			host: "coder-cursor",
			agent: "main",
			expected: "Coder: foo∕bar∕main",
		},
		{
			label: "the shared",
			editor: "cursor",
			host: "coder-vscode",
			agent: "main",
			expected: "Coder: foo∕bar∕main (legacy)",
		},
		{
			label: "VS Code's own",
			editor: "vscode",
			host: "coder-vscode",
			agent: "main",
			expected: "Coder: foo∕bar∕main",
		},
		{
			label: "this editor's, agentless",
			editor: "cursor",
			host: "coder-cursor",
			agent: undefined,
			expected: "Coder: foo∕bar",
		},
	])("labels $label host in $editor", ({ editor, host, agent, expected }) => {
		useEditor(editor);
		expect(
			workspaceLabelSuffix(
				`ssh-remote+${host}.dev.coder.com--foo--bar.main`,
				"foo",
				"bar",
				agent,
			),
		).toBe(expected);
	});
});
