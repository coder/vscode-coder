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
import type { CredentialClearResult } from "@/instrumentation/credentials";
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

interface CommandsHarnessOptions {
	readonly authenticated?: boolean;
	readonly loginMethod?: AuthLoginMethod;
	readonly loginResult?: LoginResultForTest;
	readonly credentialResult?: CredentialClearResult;
	readonly clearDeploymentError?: Error;
	readonly clearAllAuthDataError?: Error;
}

function createCommandsHarness(options: CommandsHarnessOptions = {}) {
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

	const loginCoordinator = {
		ensureLoggedIn: vi.fn((loginOptions: LoginOptionsForTest) => {
			loginOptions.onLoginMethod?.(loginMethod);
			return Promise.resolve(loginResult);
		}),
	};

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
	};

	const cliManager = {
		clearCredentials: vi.fn(() =>
			Promise.resolve(options.credentialResult ?? {}),
		),
	};

	const secretsManager = {
		getCurrentDeployment: vi.fn(() => Promise.resolve(null)),
		clearAllAuthData: vi.fn(() => {
			if (options.clearAllAuthDataError) {
				return Promise.reject(options.clearAllAuthDataError);
			}
			return Promise.resolve();
		}),
	};

	const serviceContainer = {
		getTelemetryService: () => telemetry,
		getLogger: () => logger,
		getPathResolver: () => ({}) as PathResolver,
		getMementoManager: () => ({}) as MementoManager,
		getSecretsManager: () => secretsManager as unknown as SecretsManager,
		getCliManager: () => cliManager as unknown as CliManager,
		getLoginCoordinator: () => loginCoordinator as unknown as LoginCoordinator,
		getDuplicateWorkspaceIpc: () => ({}) as DuplicateWorkspaceIpc,
		getSpeedtestPanelFactory: () => ({}) as SpeedtestPanelFactory,
	} as unknown as ServiceContainer;

	const extensionClient = {
		getAxiosInstance: () => ({ defaults: { baseURL: TEST_URL } }),
	} as unknown as CoderApi;

	const commands = new Commands(
		serviceContainer,
		extensionClient,
		deploymentManager as unknown as DeploymentManager,
	);

	return {
		commands,
		deployment,
		telemetry: sink,
		mocks: {
			cliManager,
			deploymentManager,
			loginCoordinator,
			secretsManager,
		},
	};
}

type CommandsHarness = ReturnType<typeof createCommandsHarness>;

interface CommandScenario {
	readonly name: string;
	readonly options?: CommandsHarnessOptions;
	readonly arrange?: (harness: CommandsHarness) => void;
	readonly act: (harness: CommandsHarness) => Promise<void>;
	readonly assert: (harness: CommandsHarness) => void;
}

function testCommandScenario(scenario: CommandScenario): void {
	it(scenario.name, async () => {
		const harness = createCommandsHarness(scenario.options);
		scenario.arrange?.(harness);

		await scenario.act(harness);

		scenario.assert(harness);
	});
}

describe("Commands", () => {
	describe("login telemetry", () => {
		testCommandScenario({
			name: "emits one auth.login for command login success",
			act: ({ commands }) => commands.login(),
			assert: ({ mocks, telemetry }) => {
				const events = telemetry.eventsNamed("auth.login");
				expect(events).toHaveLength(1);
				expect(events[0]).toMatchObject({
					properties: {
						source: "command",
						method: "stored_token",
						result: "success",
					},
				});
				expect(events[0].measurements.durationMs).toEqual(expect.any(Number));
				expect(mocks.loginCoordinator.ensureLoggedIn).toHaveBeenCalledWith(
					expect.objectContaining({
						safeHostname: TEST_HOSTNAME,
						url: TEST_URL,
						traceLogin: false,
					}),
				);
				expect(mocks.deploymentManager.setDeployment).toHaveBeenCalled();
			},
		});

		testCommandScenario({
			name: "uses auto_login source when requested",
			options: { loginMethod: "provided_token" },
			act: ({ commands }) => commands.login({ url: TEST_URL, autoLogin: true }),
			assert: ({ mocks, telemetry }) => {
				expect(telemetry.expectOne("auth.login").properties).toMatchObject({
					source: "auto_login",
					method: "provided_token",
					result: "success",
				});
				expect(mocks.loginCoordinator.ensureLoggedIn).toHaveBeenCalledWith(
					expect.objectContaining({ autoLogin: true, traceLogin: false }),
				);
			},
		});

		testCommandScenario({
			name: "records URL cancellation without attempting login",
			arrange: () => {
				vi.mocked(maybeAskUrl).mockResolvedValueOnce(undefined);
			},
			act: ({ commands }) => commands.login(),
			assert: ({ mocks, telemetry }) => {
				expect(telemetry.expectOne("auth.login")).toMatchObject({
					properties: {
						source: "command",
						method: "unknown",
						result: "aborted",
						reason: "no_url_provided",
					},
				});
				expect(mocks.loginCoordinator.ensureLoggedIn).not.toHaveBeenCalled();
			},
		});

		testCommandScenario({
			name: "records auth failures as auth.login errors",
			options: {
				loginMethod: "legacy_token",
				loginResult: { success: false, reason: "auth_failed" },
			},
			act: ({ commands }) => commands.login(),
			assert: ({ mocks, telemetry }) => {
				expect(telemetry.expectOne("auth.login")).toMatchObject({
					properties: {
						method: "legacy_token",
						result: "error",
						reason: "auth_failed",
					},
				});
				expect(mocks.deploymentManager.setDeployment).not.toHaveBeenCalled();
			},
		});

		testCommandScenario({
			name: "uses switch_deployment source",
			act: ({ commands }) => commands.switchDeployment(),
			assert: ({ telemetry }) => {
				expect(telemetry.expectOne("auth.login").properties).toMatchObject({
					source: "switch_deployment",
					result: "success",
				});
			},
		});
	});

	describe("logout telemetry", () => {
		testCommandScenario({
			name: "records not_authenticated as aborted",
			options: { authenticated: false },
			act: ({ commands }) => commands.logout(),
			assert: ({ mocks, telemetry }) => {
				expect(telemetry.expectOne("auth.logout")).toMatchObject({
					properties: {
						result: "aborted",
						reason: "not_authenticated",
					},
				});
				expect(mocks.cliManager.clearCredentials).not.toHaveBeenCalled();
			},
		});

		testCommandScenario({
			name: "records successful logout",
			options: { authenticated: true },
			act: ({ commands }) => commands.logout(),
			assert: ({ mocks, telemetry }) => {
				const event = telemetry.expectOne("auth.logout");
				expect(event.properties).toMatchObject({ result: "success" });
				expect(event.properties.reason).toBeUndefined();
				expect(event.measurements.durationMs).toEqual(expect.any(Number));
				expect(mocks.deploymentManager.clearDeployment).toHaveBeenCalledWith(
					"logout",
				);
				expect(mocks.cliManager.clearCredentials).toHaveBeenCalledWith(
					TEST_URL,
				);
				expect(mocks.secretsManager.clearAllAuthData).toHaveBeenCalledWith(
					TEST_HOSTNAME,
				);
			},
		});

		testCommandScenario({
			name: "records credential clear cancellation as aborted",
			options: {
				authenticated: true,
				credentialResult: {
					failureCategory: "aborted",
				},
			},
			act: ({ commands }) => commands.logout(),
			assert: ({ telemetry }) => {
				expect(telemetry.expectOne("auth.logout")).toMatchObject({
					properties: {
						result: "aborted",
						reason: "credential_clear_cancelled",
					},
				});
			},
		});

		testCommandScenario({
			name: "records credential clear failure as an error",
			options: {
				authenticated: true,
				credentialResult: {
					failureCategory: "cli",
				},
			},
			act: ({ commands }) => commands.logout(),
			assert: ({ telemetry }) => {
				expect(telemetry.expectOne("auth.logout")).toMatchObject({
					properties: {
						result: "error",
						reason: "credential_clear_failed",
					},
				});
			},
		});

		it("records logout exceptions", async () => {
			const harness = createCommandsHarness({
				authenticated: true,
				clearAllAuthDataError: new Error("secret clear failed"),
			});

			await expect(harness.commands.logout()).rejects.toThrow(
				"secret clear failed",
			);
			expect(harness.telemetry.expectOne("auth.logout")).toMatchObject({
				properties: { result: "error", reason: "exception" },
				error: { message: "secret clear failed" },
			});
		});
	});
});
