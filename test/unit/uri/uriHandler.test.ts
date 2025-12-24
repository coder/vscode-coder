import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { MementoManager } from "@/core/mementoManager";
import { SecretsManager } from "@/core/secretsManager";
import { CALLBACK_PATH } from "@/oauth/utils";
import { maybeAskUrl } from "@/promptUtils";
import { registerUriHandler } from "@/uri/uriHandler";

import {
	createMockLogger,
	createMockUser,
	InMemoryMemento,
	InMemorySecretStorage,
} from "../../mocks/testHelpers";

import type { Commands } from "@/commands";
import type { ServiceContainer } from "@/core/container";
import type { DeploymentManager } from "@/deployment/deploymentManager";
import type { LoginCoordinator, LoginOptions } from "@/login/loginCoordinator";

vi.mock("@/promptUtils", () => ({ maybeAskUrl: vi.fn() }));

const TEST_URL = "https://coder.example.com";
const TEST_HOSTNAME = "coder.example.com";

class MockCommands {
	readonly open = vi.fn().mockResolvedValue(undefined);
	readonly openDevContainer = vi.fn().mockResolvedValue(undefined);
}

class MockDeploymentManager {
	readonly setDeployment = vi.fn().mockResolvedValue(true);
}

function createMockLoginCoordinator(secretsManager: SecretsManager) {
	return {
		ensureLoggedIn: vi
			.fn()
			.mockImplementation(async (options: LoginOptions & { url: string }) => {
				const token = options.token ?? "test-token";
				// Simulate persistSessionAuth behavior
				await secretsManager.setSessionAuth(options.safeHostname, {
					url: options.url,
					token,
				});
				return {
					success: true,
					token,
					user: createMockUser(),
				};
			}),
	};
}

function createMockUri(path: string, query: string): vscode.Uri {
	return {
		path,
		query,
		toString: () => `vscode://coder.coder-remote${path}?${query}`,
	} as vscode.Uri;
}

function createTestContext() {
	vi.resetAllMocks();

	const secretStorage = new InMemorySecretStorage();
	const memento = new InMemoryMemento();
	const logger = createMockLogger();
	const secretsManager = new SecretsManager(secretStorage, memento, logger);
	const loginCoordinator = createMockLoginCoordinator(secretsManager);
	const mementoManager = new MementoManager(memento);
	const commands = new MockCommands();
	const deploymentManager = new MockDeploymentManager();

	const container = {
		getSecretsManager: () => secretsManager,
		getMementoManager: () => mementoManager,
		getLoginCoordinator: () => loginCoordinator as unknown as LoginCoordinator,
		getLogger: () => logger,
	} as unknown as ServiceContainer;

	vi.mocked(maybeAskUrl).mockImplementation((_m, urlParam) =>
		Promise.resolve(urlParam || TEST_URL),
	);

	let registeredHandler: vscode.UriHandler["handleUri"] | null = null;
	vi.mocked(vscode.window.registerUriHandler).mockImplementation((handler) => {
		registeredHandler = handler.handleUri;
		return { dispose: vi.fn() };
	});

	const showErrorMessage = vi.fn().mockResolvedValue(undefined);
	const vscodeProposed = {
		...vscode,
		window: { ...vscode.window, showErrorMessage },
	} as typeof vscode;

	registerUriHandler(
		container,
		deploymentManager as unknown as DeploymentManager,
		commands as unknown as Commands,
		vscodeProposed,
	);

	return {
		commands,
		deploymentManager,
		loginCoordinator,
		secretsManager,
		logger,
		showErrorMessage,
		handleUri: registeredHandler!,
	};
}

describe("uriHandler", () => {
	beforeEach(() => vi.resetAllMocks());

	it("registers a URI handler", () => {
		createTestContext();
		expect(vscode.window.registerUriHandler).toHaveBeenCalledOnce();
	});

	describe("/open", () => {
		it("opens workspace with parameters", async () => {
			const { handleUri, commands, deploymentManager } = createTestContext();
			await handleUri(
				createMockUri(
					"/open",
					`owner=o&workspace=w&agent=a&folder=/f&openRecent=true&url=${encodeURIComponent(TEST_URL)}`,
				),
			);

			expect(deploymentManager.setDeployment).toHaveBeenCalled();
			expect(commands.open).toHaveBeenCalledWith("o", "w", "a", "/f", true);
		});

		it.each([
			["openRecent=true", true],
			["openRecent", true],
			["openRecent=false", false],
			["", false],
		])("handles %s -> %s", async (param, expected) => {
			const { handleUri, commands } = createTestContext();
			const query = `owner=o&workspace=w&${param}&url=${encodeURIComponent(TEST_URL)}`;
			await handleUri(createMockUri("/open", query));
			expect(commands.open).toHaveBeenCalledWith(
				"o",
				"w",
				undefined,
				undefined,
				expected,
			);
		});
	});

	describe("/openDevContainer", () => {
		it("opens dev container with parameters", async () => {
			const { handleUri, commands, deploymentManager } = createTestContext();
			await handleUri(
				createMockUri(
					"/openDevContainer",
					`owner=o&workspace=w&agent=a&devContainerName=c&devContainerFolder=/f&localWorkspaceFolder=/l&localConfigFile=/cfg&url=${encodeURIComponent(TEST_URL)}`,
				),
			);

			expect(deploymentManager.setDeployment).toHaveBeenCalled();
			expect(commands.openDevContainer).toHaveBeenCalledWith(
				"o",
				"w",
				"a",
				"c",
				"/f",
				"/l",
				"/cfg",
			);
		});
	});

	describe("missing required parameters", () => {
		it.each([
			["/open", "workspace=w", "owner"],
			["/open", "owner=o", "workspace"],
			[
				"/openDevContainer",
				"workspace=w&agent=a&devContainerName=c&devContainerFolder=/f",
				"owner",
			],
			[
				"/openDevContainer",
				"owner=o&workspace=w&devContainerName=c&devContainerFolder=/f",
				"agent",
			],
			[
				"/openDevContainer",
				"owner=o&workspace=w&agent=a&devContainerFolder=/f",
				"devContainerName",
			],
			[
				"/openDevContainer",
				"owner=o&workspace=w&agent=a&devContainerName=c",
				"devContainerFolder",
			],
		])("%s with %s throws for missing %s", async (path, query, param) => {
			const { handleUri, showErrorMessage } = createTestContext();
			await handleUri(
				createMockUri(path, `${query}&url=${encodeURIComponent(TEST_URL)}`),
			);
			expect(showErrorMessage).toHaveBeenCalledWith(
				"Failed to handle URI",
				expect.objectContaining({
					detail: expect.stringContaining(`${param} must be specified`),
				}),
			);
		});

		it("throws when localConfigFile provided without localWorkspaceFolder", async () => {
			const { handleUri, showErrorMessage } = createTestContext();
			await handleUri(
				createMockUri(
					"/openDevContainer",
					`owner=o&workspace=w&agent=a&devContainerName=c&devContainerFolder=/f&localConfigFile=/cfg&url=${encodeURIComponent(TEST_URL)}`,
				),
			);
			expect(showErrorMessage).toHaveBeenCalledWith(
				"Failed to handle URI",
				expect.objectContaining({
					detail: expect.stringContaining(
						"localWorkspaceFolder must be specified",
					),
				}),
			);
		});

		it("throws for unknown path", async () => {
			const { handleUri, showErrorMessage } = createTestContext();
			await handleUri(createMockUri("/unknown", ""));
			expect(showErrorMessage).toHaveBeenCalledWith(
				"Failed to handle URI",
				expect.objectContaining({
					detail: expect.stringContaining("Unknown path"),
				}),
			);
		});
	});

	describe("deployment setup", () => {
		it("stores token from URI", async () => {
			const { handleUri, secretsManager } = createTestContext();
			await handleUri(
				createMockUri(
					"/open",
					`owner=o&workspace=w&url=${encodeURIComponent(TEST_URL)}&token=tok`,
				),
			);

			const stored = await secretsManager.getSessionAuth(TEST_HOSTNAME);
			expect(stored).toEqual({ url: TEST_URL, token: "tok" });
		});

		it("throws on login failure", async () => {
			const { handleUri, loginCoordinator, showErrorMessage } =
				createTestContext();
			loginCoordinator.ensureLoggedIn.mockResolvedValue({ success: false });

			await handleUri(
				createMockUri(
					"/open",
					`owner=o&workspace=w&url=${encodeURIComponent(TEST_URL)}`,
				),
			);
			expect(showErrorMessage).toHaveBeenCalledWith(
				"Failed to handle URI",
				expect.objectContaining({
					detail: expect.stringContaining("Failed to login"),
				}),
			);
		});

		it("throws when URL cancelled", async () => {
			const { handleUri, showErrorMessage } = createTestContext();
			vi.mocked(maybeAskUrl).mockResolvedValue(undefined);

			await handleUri(createMockUri("/open", "owner=o&workspace=w"));
			expect(showErrorMessage).toHaveBeenCalledWith(
				"Failed to handle URI",
				expect.objectContaining({
					detail: expect.stringContaining("url must be provided"),
				}),
			);
		});
	});

	describe("error handling", () => {
		it("logs and shows error message", async () => {
			const { handleUri, logger, showErrorMessage } = createTestContext();
			await handleUri(createMockUri("/open", "workspace=w"));

			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to handle URI"),
			);
			expect(showErrorMessage).toHaveBeenCalled();
		});

		it("propagates command errors", async () => {
			const { handleUri, commands, showErrorMessage } = createTestContext();
			commands.open.mockRejectedValue(new Error("Connection failed"));

			await handleUri(
				createMockUri(
					"/open",
					`owner=o&workspace=w&url=${encodeURIComponent(TEST_URL)}`,
				),
			);
			expect(showErrorMessage).toHaveBeenCalledWith(
				"Failed to handle URI",
				expect.objectContaining({
					detail: expect.stringContaining("Connection failed"),
				}),
			);
		});
	});

	describe(CALLBACK_PATH, () => {
		interface CallbackData {
			state: string;
			code: string | null;
			error: string | null;
		}

		it("stores OAuth callback with code and state", async () => {
			const { handleUri, secretsManager } = createTestContext();

			const callbackPromise = new Promise<CallbackData>((resolve) => {
				secretsManager.onDidChangeOAuthCallback(resolve);
			});

			await handleUri(
				createMockUri(CALLBACK_PATH, "code=auth-code&state=test-state"),
			);

			const callbackData = await callbackPromise;
			expect(callbackData).toEqual({
				state: "test-state",
				code: "auth-code",
				error: null,
			});
		});

		it("stores OAuth callback with error", async () => {
			const { handleUri, secretsManager } = createTestContext();

			const callbackPromise = new Promise<CallbackData>((resolve) => {
				secretsManager.onDidChangeOAuthCallback(resolve);
			});

			await handleUri(
				createMockUri(CALLBACK_PATH, "state=test-state&error=access_denied"),
			);

			const callbackData = await callbackPromise;
			expect(callbackData).toEqual({
				state: "test-state",
				code: null,
				error: "access_denied",
			});
		});

		it("does not store callback when state is missing", async () => {
			const { handleUri, secretsManager } = createTestContext();

			let callbackReceived = false;
			secretsManager.onDidChangeOAuthCallback(() => {
				callbackReceived = true;
			});

			await handleUri(createMockUri(CALLBACK_PATH, "code=auth-code"));

			// Flush microtask queue to ensure any async callback would have fired
			await Promise.resolve();

			expect(callbackReceived).toBe(false);
		});
	});
});
