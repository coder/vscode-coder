import { vol } from "memfs";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as vscode from "vscode";

import { AuthInterceptor } from "@/api/authInterceptor";
import { DEFAULT_OAUTH_SCOPES } from "@/oauth/constants";
import { OAuthSessionManager } from "@/oauth/sessionManager";
import { ConnectionSetup } from "@/remote/connectionSetup";
import { Remote, workspaceLabelSuffix } from "@/remote/remote";
import { MementoManager } from "@/storage/mementoManager";
import { PathResolver } from "@/storage/pathResolver";
import { SecretsManager } from "@/storage/secretsManager";

import { createTestCoderApi } from "../../mocks/coderApi";
import { createTestTelemetryService } from "../../mocks/telemetry";
import {
	createAxiosError,
	createMockLogger,
	createMockUser,
	createMockServiceContainer,
	flush,
	getAxiosMockAdapter,
	InMemoryMemento,
	InMemorySecretStorage,
	LogCollector,
	MockConfigurationProvider,
	MockUserInteraction,
	setupAxiosMockRoutes,
	useEditor,
} from "../../mocks/testHelpers";
import {
	createMockClientRegistration,
	createMockOAuthMetadata,
	createMockTokenResponse,
} from "../oauth/testUtils";

import type { AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";

import type { CliManager } from "@/cli/cliManager";
import type { Commands } from "@/commands";
import type { Logger } from "@/logging/logger";
import type { CliAuth } from "@/settings/cli";

const mockWorkspace = vscode.workspace as typeof vscode.workspace & {
	workspaceFile: vscode.Uri | undefined;
	workspaceFolders: vscode.WorkspaceFolder[];
};

vi.mock("axios", async () => {
	const actual = await vi.importActual<typeof import("axios")>("axios");
	const adapter = vi.fn();
	return {
		...actual,
		default: {
			...actual.default,
			create: vi.fn((config?: AxiosRequestConfig) =>
				actual.default.create({ ...config, adapter }),
			),
			__mockAdapter: adapter,
		},
	};
});

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
	useKeyring: false,
	refuseRedirects: false,
};

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
	const cliManager = {
		configure: vi.fn().mockResolvedValue(undefined),
	} as unknown as CliManager;
	const serviceContainer = createMockServiceContainer({
		logger,
		pathResolver,
		mementoManager,
		cliManager,
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
			new ConnectionSetup(serviceContainer, vscode.ExtensionMode.Production),
		),
		ensureLoggedInWithDialog,
		mementoManager,
		secretsManager,
		userInteraction,
		serviceContainer,
		cliManager,
	};
}

describe("Remote", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vol.reset();
		mockWorkspace.workspaceFile = undefined;
		mockWorkspace.workspaceFolders = [];
	});

	describe("remote session credentials", () => {
		const USER_IDS: Record<string, string> = {
			"alice-token": "alice",
			"rotated-token": "alice",
			"bob-token": "bob",
		};
		const tokenOf = (config: InternalAxiosRequestConfig) =>
			String(config.headers["Coder-Session-Token"]);
		/** Route answering `data` for tokens in USER_IDS and 401 otherwise. */
		const authorized =
			(data: (userId: string) => unknown) =>
			(config: InternalAxiosRequestConfig) => {
				const userId = USER_IDS[tokenOf(config)];
				if (!userId) throw createAxiosError(401, "expired", { ...config });
				return data(userId);
			};
		const lookupUser = authorized((id) => createMockUser({ id }));

		function setup(
			token = "alice-token",
			routes: Record<string, unknown> = {},
		) {
			const context = createRemote();
			const refresh = vi.fn(() =>
				createMockTokenResponse({
					access_token: "rotated-token",
					scope: DEFAULT_OAUTH_SCOPES,
				}),
			);
			setupAxiosMockRoutes(getAxiosMockAdapter(), {
				"/.well-known/oauth-authorization-server": createMockOAuthMetadata(
					CLI_AUTH.url,
				),
				"/oauth2/token": refresh,
				"/api/v2/users/me": lookupUser,
				...routes,
			});
			const client = createTestCoderApi({ baseUrl: CLI_AUTH.url, token });
			const oauth = OAuthSessionManager.create(
				{ url: CLI_AUTH.url, safeHostname: SAFE_HOSTNAME },
				context.serviceContainer,
			);
			onTestFinished(() => oauth.dispose());
			const subscribe = vi.spyOn(
				context.secretsManager,
				"onDidChangeSessionAuth",
			);
			const watch = () => {
				const method = "watchRemoteSessionAuth";
				const watcher = context.remote[method](SAFE_HOSTNAME, client, oauth);
				onTestFinished(() => watcher.dispose());
				return { watcher, update: subscribe.mock.calls[0][1] };
			};
			return { ...context, client, oauth, refresh, watch };
		}

		interface Options {
			url?: string;
			previous?: string;
			initial?: string;
		}
		it.each<[string, boolean, string, Options?]>([
			["token rotates", false, "rotated-token"],
			["user changes", true, "bob-token"],
			["user changes back", true, "alice-token", { previous: "bob-token" }],
			[
				"URL changes",
				true,
				"rotated-token",
				{ url: "http://coder.example.com" },
			],
			["bound user is unknown", true, "rotated-token", { initial: "expired" }],
			["token is rejected", false, "invalid-token"],
		])(
			"when the %s, cancels pending requests: %s",
			async (_change, canceled, token, options = {}) => {
				const {
					url = CLI_AUTH.url,
					previous,
					initial = "alice-token",
				} = options;
				const pending = Promise.withResolvers<string>();
				const started = Promise.withResolvers<void>();
				const { client, oauth, cliManager, watch } = setup(initial, {
					"/pending": () => {
						started.resolve();
						return pending.promise;
					},
				});
				const { update } = watch();
				if (previous) await update({ url, token: previous });
				const setDeployment = vi.spyOn(oauth, "setDeployment");
				const request = client.getAxiosInstance().get("/pending");
				await started.promise;

				await update({ url, token });
				pending.resolve("done");

				await (canceled
					? expect(request).rejects.toMatchObject({ code: "ERR_CANCELED" })
					: expect(request).resolves.toMatchObject({ data: "done" }));
				const accepted = token in USER_IDS;
				expect(client.getHost()).toBe(url);
				expect(client.getSessionToken()).toBe(accepted ? token : initial);
				// Resetting OAuth cancels the previous account's pending refresh.
				expect(setDeployment).toHaveBeenCalledTimes(canceled ? 1 : 0);
				if (accepted) {
					expect(cliManager.configure).toHaveBeenLastCalledWith(url, token, {
						silent: true,
					});
				} else {
					expect(cliManager.configure).not.toHaveBeenCalled();
				}
			},
		);

		type Watch = ReturnType<ReturnType<typeof setup>["watch"]>;
		it.each<[string, (watch: Watch) => unknown, string | undefined]>([
			[
				"a newer update",
				({ update }) => update({ url: CLI_AUTH.url, token: "bob-token" }),
				"bob-token",
			],
			["sign-out", ({ update }) => update(undefined), undefined],
			["disposal", ({ watcher }) => watcher.dispose(), "alice-token"],
		])("ignores an update superseded by %s", async (_by, supersede, token) => {
			const boundUser =
				Promise.withResolvers<ReturnType<typeof createMockUser>>();
			const { client, cliManager, watch } = setup("alice-token", {
				"/api/v2/users/me": (config: InternalAxiosRequestConfig) =>
					tokenOf(config) === "alice-token"
						? boundUser.promise
						: lookupUser(config),
			});
			const watching = watch();
			const stale = watching.update({
				url: CLI_AUTH.url,
				token: "rotated-token",
			});
			await flush();

			const superseding = supersede(watching);
			boundUser.resolve(createMockUser({ id: "alice" }));
			await Promise.all([stale, superseding]);

			expect(client.getSessionToken()).toBe(token);
			expect(cliManager.configure).not.toHaveBeenCalledWith(
				CLI_AUTH.url,
				"rotated-token",
				expect.anything(),
			);
		});

		it("recovers OAuth when the initial user lookup also needs refresh", async () => {
			const { client, oauth, cliManager, refresh, watch, ...context } = setup(
				"expired",
				{ "/protected": authorized(() => "recovered") },
			);
			await context.secretsManager.setSessionAuth(SAFE_HOSTNAME, {
				url: CLI_AUTH.url,
				token: "expired",
				oauth: {
					refresh_token: "refresh-token",
					expiry_timestamp: Date.now() + 3_600_000,
					scope: DEFAULT_OAUTH_SCOPES,
					registration: createMockClientRegistration(),
				},
			});
			const interceptor = new AuthInterceptor(
				client,
				oauth,
				context.serviceContainer,
			);
			onTestFinished(() => interceptor.dispose());
			watch();

			await expect(
				client.getAxiosInstance().get("/protected"),
			).resolves.toMatchObject({ data: "recovered" });
			await flush();

			expect(refresh).toHaveBeenCalledOnce();
			expect(cliManager.configure).toHaveBeenCalledWith(
				CLI_AUTH.url,
				"rotated-token",
				{ silent: true },
			);
		});
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
