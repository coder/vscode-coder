import { describe, expect, it, vi } from "vitest";

import { Commands } from "@/commands";
import { maybeAskUrl } from "@/promptUtils";

import { createTelemetryHarness } from "../mocks/telemetry";
import {
	createMockLogger,
	createMockUser,
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
import type { LoginCoordinator, LoginResult } from "@/login/loginCoordinator";
import type { NetcheckPanelFactory } from "@/webviews/netcheck/netcheckPanelFactory";
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

type LoginResultForTest = LoginResult & {
	readonly user?: ReturnType<typeof createMockUser>;
};

interface SetupOptions {
	readonly authenticated?: boolean;
	readonly loginResult?: LoginResultForTest;
	readonly clearAllAuthDataError?: Error;
}

function setup(options: SetupOptions = {}) {
	vi.clearAllMocks();
	new MockUserInteraction();
	vi.mocked(maybeAskUrl).mockResolvedValue(TEST_URL);

	const { sink, service } = createTelemetryHarness();
	const deployment: Deployment = {
		url: TEST_URL,
		safeHostname: TEST_HOSTNAME,
	};
	const loginResult =
		options.loginResult ??
		({
			success: true,
			method: "stored_token",
			user: createMockUser(),
			token: "test-token",
		} satisfies LoginResultForTest);
	const loginCoordinator: Pick<LoginCoordinator, "ensureLoggedIn"> = {
		ensureLoggedIn: vi.fn(() => Promise.resolve(loginResult)),
	};

	const deploymentManager: Pick<
		DeploymentManager,
		| "isAuthenticated"
		| "getCurrentDeployment"
		| "setDeployment"
		| "clearDeployment"
	> = {
		isAuthenticated: vi.fn(() => options.authenticated ?? false),
		getCurrentDeployment: vi.fn(() => deployment),
		setDeployment: vi.fn(() => Promise.resolve()),
		clearDeployment: vi.fn(() => Promise.resolve()),
	};

	const cliManager: Pick<CliManager, "clearCredentials"> = {
		clearCredentials: vi.fn(() => Promise.resolve()),
	};

	const secretsManager: Pick<
		SecretsManager,
		"getCurrentDeployment" | "clearAllAuthData"
	> = {
		getCurrentDeployment: vi.fn(() => Promise.resolve(null)),
		clearAllAuthData: vi.fn(() => {
			if (options.clearAllAuthDataError) {
				return Promise.reject(options.clearAllAuthDataError);
			}
			return Promise.resolve();
		}),
	};

	const serviceContainer = {
		getTelemetryService: () => service,
		getLogger: () => createMockLogger(),
		getPathResolver: () => ({}) as PathResolver,
		getMementoManager: () => ({}) as MementoManager,
		getSecretsManager: () => secretsManager,
		getCliManager: () => cliManager,
		getLoginCoordinator: () => loginCoordinator,
		getDuplicateWorkspaceIpc: () => ({}) as DuplicateWorkspaceIpc,
		getSpeedtestPanelFactory: () => ({}) as SpeedtestPanelFactory,
		getNetcheckPanelFactory: () => ({}) as NetcheckPanelFactory,
	} as ServiceContainer;

	const extensionClient = {
		getAxiosInstance: () => ({ defaults: { baseURL: TEST_URL } }),
	} as unknown as CoderApi;

	const commands = new Commands(
		serviceContainer,
		extensionClient,
		deploymentManager as DeploymentManager,
	);

	return {
		commands,
		sink,
		mocks: { cliManager, deploymentManager, loginCoordinator, secretsManager },
	};
}

describe("Commands", () => {
	describe("login telemetry", () => {
		it("emits one auth.login for command login success", async () => {
			const { commands, mocks, sink } = setup();

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
			expect(mocks.loginCoordinator.ensureLoggedIn).toHaveBeenCalledWith(
				expect.objectContaining({
					safeHostname: TEST_HOSTNAME,
					url: TEST_URL,
				}),
			);
			expect(mocks.deploymentManager.setDeployment).toHaveBeenCalled();
		});

		it("uses auto_login source when requested", async () => {
			const { commands, mocks, sink } = setup({
				loginResult: {
					success: true,
					method: "provided_token",
					user: createMockUser(),
					token: "test-token",
				},
			});

			await commands.login({ url: TEST_URL, autoLogin: true });

			expect(sink.expectOne("auth.login").properties).toMatchObject({
				source: "auto_login",
				method: "provided_token",
				result: "success",
			});
			expect(mocks.loginCoordinator.ensureLoggedIn).toHaveBeenCalledWith(
				expect.objectContaining({ autoLogin: true }),
			);
		});

		it("records URL cancellation without attempting login", async () => {
			const { commands, mocks, sink } = setup();
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
			expect(mocks.loginCoordinator.ensureLoggedIn).not.toHaveBeenCalled();
		});

		it("records auth failures as auth.login errors", async () => {
			const { commands, mocks, sink } = setup({
				loginResult: {
					success: false,
					method: "cli_token",
					reason: "auth_failed",
				},
			});

			await commands.login();

			expect(sink.expectOne("auth.login")).toMatchObject({
				properties: {
					method: "cli_token",
					result: "error",
					"error.type": "auth_failed",
				},
			});
			expect(mocks.deploymentManager.setDeployment).not.toHaveBeenCalled();
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
			const { commands, mocks, sink } = setup({ authenticated: false });

			await commands.logout();

			expect(sink.expectOne("auth.logout")).toMatchObject({
				properties: {
					result: "aborted",
					reason: "not_authenticated",
				},
			});
			expect(mocks.cliManager.clearCredentials).not.toHaveBeenCalled();
		});

		it("records successful logout", async () => {
			const { commands, mocks, sink } = setup({ authenticated: true });

			await commands.logout();

			const event = sink.expectOne("auth.logout");
			expect(event.properties).toMatchObject({ result: "success" });
			expect(event.properties.reason).toBeUndefined();
			expect(event.measurements.durationMs).toEqual(expect.any(Number));
			expect(mocks.deploymentManager.clearDeployment).toHaveBeenCalledWith(
				"logout",
			);
			expect(mocks.cliManager.clearCredentials).toHaveBeenCalledWith(TEST_URL);
			expect(mocks.secretsManager.clearAllAuthData).toHaveBeenCalledWith(
				TEST_HOSTNAME,
			);
		});

		it("records logout exceptions", async () => {
			const { commands, sink } = setup({
				authenticated: true,
				clearAllAuthDataError: new Error("secret clear failed"),
			});

			await expect(commands.logout()).rejects.toThrow("secret clear failed");

			expect(sink.expectOne("auth.logout")).toMatchObject({
				properties: { result: "error", "error.type": "exception" },
				error: { message: "secret clear failed" },
			});
		});
	});
});
