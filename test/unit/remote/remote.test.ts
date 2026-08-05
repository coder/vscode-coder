import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { MementoManager } from "@/core/mementoManager";
import { PathResolver } from "@/core/pathResolver";
import { SecretsManager } from "@/core/secretsManager";
import { Remote } from "@/remote/remote";

import { createTestTelemetryService } from "../../mocks/telemetry";
import {
	createMockLogger,
	createMockServiceContainer,
	InMemoryMemento,
	InMemorySecretStorage,
	LogCollector,
	MockConfigurationProvider,
	MockUserInteraction,
} from "../../mocks/testHelpers";

import type { Commands } from "@/commands";
import type { CliManager } from "@/core/cliManager";
import type { Logger } from "@/logging/logger";

const mockWorkspace = vscode.workspace as typeof vscode.workspace & {
	workspaceFile: vscode.Uri | undefined;
	workspaceFolders: vscode.WorkspaceFolder[];
};
const mockEnv = vscode.env as typeof vscode.env & { uriScheme: string };

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const SAFE_HOSTNAME = "coder.example.com";
const REMOTE_AUTHORITY =
	"ssh-remote+coder-vscode.coder.example.com--testuser--test-workspace.main";
const CURSOR_REMOTE_AUTHORITY =
	"ssh-remote+coder-cursor.coder.example.com--testuser--test-workspace.main";
const WINDSURF_REMOTE_AUTHORITY =
	"ssh-remote+coder-windsurf.coder.example.com--testuser--test-workspace.main";
const REMOTE_SSH_EXTENSION_ID = "anysphere.remote-ssh";
const MISMATCHED_URL =
	"https://cursor.example.com/private?token=sensitive-url-token";
const SESSION_TOKEN = "sensitive-session-token";

function createRemote(logger: Logger = createMockLogger()) {
	new MockConfigurationProvider();
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
		mockEnv.uriScheme = "vscode";
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

	it("migrates a legacy folder with its full URI", async () => {
		mockEnv.uriScheme = "cursor";
		const { remote, mementoManager } = createRemote();
		setWorkspace([
			createUri("/workspace", {
				query: "window=active",
				fragment: "selection",
			}),
		]);

		await expect(
			remote.setup(REMOTE_AUTHORITY, "none", REMOTE_SSH_EXTENSION_ID),
		).resolves.toBeUndefined();

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"vscode.openFolder",
			createUri("/workspace", {
				authority: CURSOR_REMOTE_AUTHORITY,
				query: "window=active",
				fragment: "selection",
			}),
			false,
		);
		expect(await mementoManager.getAndClearStartupMode()).toBe("start");
	});

	it("migrates a saved multi-root workspace file", async () => {
		mockEnv.uriScheme = "cursor";
		const { remote, mementoManager } = createRemote();
		setWorkspace(
			[createUri("/first-folder"), createUri("/second-folder")],
			createUri("/project.code-workspace", {
				query: "window=active",
				fragment: "selection",
			}),
		);

		await expect(
			remote.setup(REMOTE_AUTHORITY, "none", REMOTE_SSH_EXTENSION_ID),
		).resolves.toBeUndefined();

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"vscode.openFolder",
			createUri("/project.code-workspace", {
				authority: CURSOR_REMOTE_AUTHORITY,
				query: "window=active",
				fragment: "selection",
			}),
			false,
		);
		expect(await mementoManager.getAndClearStartupMode()).toBe("start");
	});

	interface EmptyWindowMigrationCase {
		startupMode: "none" | "start" | "update";
		expectedStartupMode: "start" | "update";
	}
	it.each<EmptyWindowMigrationCase>([
		{ startupMode: "none", expectedStartupMode: "start" },
		{ startupMode: "start", expectedStartupMode: "start" },
		{ startupMode: "update", expectedStartupMode: "update" },
	])(
		"migrates an empty window and preserves $startupMode startup mode",
		async ({ startupMode, expectedStartupMode }) => {
			mockEnv.uriScheme = "cursor";
			const { remote, mementoManager } = createRemote();

			await expect(
				remote.setup(REMOTE_AUTHORITY, startupMode, REMOTE_SSH_EXTENSION_ID),
			).resolves.toBeUndefined();

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"vscode.newWindow",
				{
					remoteAuthority: CURSOR_REMOTE_AUTHORITY,
					reuseWindow: true,
				},
			);
			expect(await mementoManager.getAndClearStartupMode()).toBe(
				expectedStartupMode,
			);
		},
	);

	it.each([
		{ choice: undefined, docsUrls: [] },
		{
			choice: "Learn More",
			docsUrls: [expect.stringContaining("multi-root-workspaces")],
		},
	])(
		"keeps an untitled multi-root workspace on the old host (choice: $choice)",
		async ({ choice, docsUrls }) => {
			mockEnv.uriScheme = "cursor";
			const { remote, mementoManager, userInteraction } = createRemote();
			setWorkspace(
				[createUri("/first-folder"), createUri("/second-folder")],
				createUri("/Untitled-1.code-workspace", {
					scheme: "untitled",
					authority: "",
				}),
			);
			userInteraction.setResponse(/coder-vscode SSH host/, choice);

			await expect(
				remote.setup(REMOTE_AUTHORITY, "update", REMOTE_SSH_EXTENSION_ID),
			).resolves.toBeUndefined();

			const warning = userInteraction
				.getMessageCalls()
				.find((call) => call.level === "warning");
			expect(warning?.message).toContain("coder-vscode SSH host");
			expect(warning?.items).toEqual(["Learn More"]);
			expect(userInteraction.getExternalUrls()).toEqual(docsUrls);
			expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
			expect(await mementoManager.getAndClearStartupMode()).toBe("none");
		},
	);

	it("continues setup for the current authority without reopening", async () => {
		mockEnv.uriScheme = "cursor";
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
		mockEnv.uriScheme = "cursor";
		const { remote, ensureLoggedInWithDialog, mementoManager } = createRemote();

		await expect(
			remote.setup(WINDSURF_REMOTE_AUTHORITY, "none", REMOTE_SSH_EXTENSION_ID),
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
});
