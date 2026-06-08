import { describe, expect, it, vi } from "vitest";

import { Commands } from "@/commands";
import { maybeAskUrl } from "@/promptUtils";

import { createTestTelemetryService, TestSink } from "../mocks/telemetry";
import {
	createMockLogger,
	createMockUser,
	MockConfigurationProvider,
	MockUserInteraction,
} from "../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";
import type { CliManager } from "@/core/cliManager";
import type { ServiceContainer } from "@/core/container";
import type { MementoManager } from "@/core/mementoManager";
import type { PathResolver } from "@/core/pathResolver";
import type { SecretsManager } from "@/core/secretsManager";
import type { DeploymentManager } from "@/deployment/deploymentManager";
import type { Deployment } from "@/deployment/types";
import type {
	AuthLoginMethod,
	LoginPromptReason,
} from "@/instrumentation/auth";
import type { LoginCoordinator } from "@/login/loginCoordinator";
import type { SpeedtestPanelFactory } from "@/webviews/speedtest/speedtestPanelFactory";
import type { DuplicateWorkspaceIpc } from "@/workspace/duplicateWorkspaceIpc";

vi.mock("@/promptUtils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/promptUtils")>();
	return { ...actual, maybeAskUrl: vi.fn() };
});

vi.mock("@/workspace/workspacesProvider", () => {
	class AgentTreeItem {}
	class WorkspaceTreeItem {}
	return { AgentTreeItem, WorkspaceTreeItem };
});

const TEST_URL = "https://coder.example.com";
const TEST_HOSTNAME = "coder.example.com";

interface LoginOptionsForTest {
	safeHostname: string;
	url: string;
	autoLogin?: boolean;
	traceLogin?: boolean;
	onLoginMethod?: (method: AuthLoginMethod) => void;
}

type LoginResultForTest =
	| { success: true; user: ReturnType<typeof createMockUser>; token: string }
	| { success: false; reason: LoginPromptReason };

interface SetupOptions {
	readonly authenticated?: boolean;
	readonly loginMethod?: AuthLoginMethod;
	readonly loginResult?: LoginResultForTest;
	readonly credentialResult?: Awaited<
		ReturnType<CliManager["clearCredentials"]>
	>;
	readonly clearDeploymentError?: Error;
	readonly clearAllAuthDataError?: Error;
}

function setup(options: SetupOptions = {}) {
	vi.clearAllMocks();
	new MockConfigurationProvider();
	new MockUserInteraction();
	vi.mocked(maybeAskUrl).mockResolvedValue(TEST_URL);

	const sink = new TestSink();
	const telemetry = createTestTelemetryService(sink);
	const logger = createMockLogger();
	const deployment: Deployment = {
		url: TEST_URL,
		safeHostname: TEST_HOSTNAME,
	};
	const loginResult =
		options.loginResult ??
		({
			success: true,
			user: createMockUser(),
			token: "test-token",
		} satisfies LoginResultForTest);
	const loginMethod = options.loginMethod ?? "stored_token";

	const ensureLoggedIn = vi.fn(
		(loginOptions: LoginOptionsForTest): Promise<LoginResultForTest> => {
			loginOptions.onLoginMethod?.(loginMethod);
			return Promise.resolve(loginResult);
		},
	);
	const loginCoordinator = {
		ensureLoggedIn,
	} as unknown as LoginCoordinator;

	const deploymentManager = {
		isAuthenticated: vi.fn(() => options.authenticated ?? false),
		getCurrentDeployment: vi.fn(() => deployment),
		setDeployment: vi.fn(() => Promise.resolve()),
		clearDeployment: vi.fn(() => {
			if (options.clearDeploymentError) {
				return Promise.reject(options.clearDeploymentError);
			}
			return Promise.resolve();
		}),
	} as unknown as DeploymentManager;

	const cliManager = {
		clearCredentials: vi.fn(() =>
			Promise.resolve(options.credentialResult ?? { category: "file" }),
		),
	} as unknown as CliManager;

	const secretsManager = {
		getCurrentDeployment: vi.fn(() => Promise.resolve(null)),
		clearAllAuthData: vi.fn(() => {
			if (options.clearAllAuthDataError) {
				return Promise.reject(options.clearAllAuthDataError);
			}
			return Promise.resolve();
		}),
	} as unknown as SecretsManager;

	const serviceContainer = {
		getTelemetryService: () => telemetry,
		getLogger: () => logger,
		getPathResolver: () => ({}) as PathResolver,
		getMementoManager: () => ({}) as MementoManager,
		getSecretsManager: () => secretsManager,
		getCliManager: () => cliManager,
		getLoginCoordinator: () => loginCoordinator,
		getDuplicateWorkspaceIpc: () => ({}) as DuplicateWorkspaceIpc,
		getSpeedtestPanelFactory: () => ({}) as SpeedtestPanelFactory,
	} as unknown as ServiceContainer;

	const extensionClient = {
		getAxiosInstance: () => ({ defaults: { baseURL: TEST_URL } }),
	} as unknown as CoderApi;

	const commands = new Commands(
		serviceContainer,
		extensionClient,
		deploymentManager,
	);

	return {
		commands,
		deployment,
		deploymentManager,
		ensureLoggedIn,
		cliManager,
		secretsManager,
		sink,
	};
}

describe("Commands", () => {
	describe("login telemetry", () => {
		it("emits one auth.login for command login success", async () => {
			const { commands, deploymentManager, ensureLoggedIn, sink } = setup();

			await commands.login();

			const events = sink.eventsNamed("auth.login");
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				properties: {
					source: "command",
					method: "stored_token",
					result: "success",
				},
			});
			expect(events[0].measurements.durationMs).toEqual(expect.any(Number));
			expect(ensureLoggedIn).toHaveBeenCalledWith(
				expect.objectContaining({
					safeHostname: TEST_HOSTNAME,
					url: TEST_URL,
					traceLogin: false,
				}),
			);
			expect(deploymentManager.setDeployment).toHaveBeenCalled();
		});

		it("uses auto_login source when requested", async () => {
			const { commands, ensureLoggedIn, sink } = setup({
				loginMethod: "provided_token",
			});

			await commands.login({ url: TEST_URL, autoLogin: true });

			expect(sink.expectOne("auth.login").properties).toMatchObject({
				source: "auto_login",
				method: "provided_token",
				result: "success",
			});
			expect(ensureLoggedIn).toHaveBeenCalledWith(
				expect.objectContaining({ autoLogin: true, traceLogin: false }),
			);
		});

		it("records URL cancellation without attempting login", async () => {
			const { commands, ensureLoggedIn, sink } = setup();
			vi.mocked(maybeAskUrl).mockResolvedValueOnce(undefined);

			await commands.login();

			expect(sink.expectOne("auth.login")).toMatchObject({
				properties: {
					source: "command",
					method: "unknown",
					result: "aborted",
					reason: "no_url_provided",
				},
			});
			expect(ensureLoggedIn).not.toHaveBeenCalled();
		});

		it("records auth failures as auth.login errors", async () => {
			const { commands, deploymentManager, sink } = setup({
				loginMethod: "legacy_token",
				loginResult: { success: false, reason: "auth_failed" },
			});

			await commands.login();

			expect(sink.expectOne("auth.login")).toMatchObject({
				properties: {
					method: "legacy_token",
					result: "error",
					reason: "auth_failed",
				},
			});
			expect(deploymentManager.setDeployment).not.toHaveBeenCalled();
		});

		it("uses switch_deployment source", async () => {
			const { commands, sink } = setup();

			await commands.switchDeployment();

			expect(sink.expectOne("auth.login").properties).toMatchObject({
				source: "switch_deployment",
				result: "success",
			});
		});
	});

	describe("logout telemetry", () => {
		it("records not_authenticated as aborted", async () => {
			const { commands, cliManager, sink } = setup({ authenticated: false });

			await commands.logout();

			expect(sink.expectOne("auth.logout")).toMatchObject({
				properties: {
					result: "aborted",
					reason: "not_authenticated",
				},
			});
			expect(cliManager.clearCredentials).not.toHaveBeenCalled();
		});

		it("records successful logout", async () => {
			const { commands, deploymentManager, cliManager, secretsManager, sink } =
				setup({ authenticated: true });

			await commands.logout();

			const event = sink.expectOne("auth.logout");
			expect(event.properties).toMatchObject({ result: "success" });
			expect(event.properties.reason).toBeUndefined();
			expect(event.measurements.durationMs).toEqual(expect.any(Number));
			expect(deploymentManager.clearDeployment).toHaveBeenCalledWith("logout");
			expect(cliManager.clearCredentials).toHaveBeenCalledWith(TEST_URL);
			expect(secretsManager.clearAllAuthData).toHaveBeenCalledWith(
				TEST_HOSTNAME,
			);
		});

		it("records credential clear cancellation as aborted", async () => {
			const { commands, sink } = setup({
				authenticated: true,
				credentialResult: {
					category: "keyring",
					failureCategory: "aborted",
				},
			});

			await commands.logout();

			expect(sink.expectOne("auth.logout")).toMatchObject({
				properties: {
					result: "aborted",
					reason: "credential_clear_cancelled",
				},
			});
		});

		it("records credential clear failure as an error", async () => {
			const { commands, sink } = setup({
				authenticated: true,
				credentialResult: {
					category: "keyring",
					failureCategory: "cli",
				},
			});

			await commands.logout();

			expect(sink.expectOne("auth.logout")).toMatchObject({
				properties: {
					result: "error",
					reason: "credential_clear_failed",
				},
			});
		});

		it("records logout exceptions", async () => {
			const { commands, sink } = setup({
				authenticated: true,
				clearAllAuthDataError: new Error("secret clear failed"),
			});

			await expect(commands.logout()).rejects.toThrow("secret clear failed");
			expect(sink.expectOne("auth.logout")).toMatchObject({
				properties: { result: "error", reason: "exception" },
				error: { message: "secret clear failed" },
			});
		});
	});
});
