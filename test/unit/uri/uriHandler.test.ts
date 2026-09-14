import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { MementoManager } from "@/core/mementoManager";
import { SecretsManager } from "@/core/secretsManager";
import { OAuthCallback } from "@/oauth/oauthCallback";
import { CALLBACK_PATH } from "@/oauth/utils";
import { maybeAskUrl } from "@/promptUtils";
import { NOOP_TELEMETRY_REPORTER } from "@/telemetry/reporter";
import { registerUriHandler } from "@/uri/uriHandler";

import {
	createMockLogger,
	createMockUser,
	InMemoryMemento,
	InMemorySecretStorage,
	MockContextManager,
	MockUserInteraction,
} from "../../mocks/testHelpers";

import type { ServiceContainer } from "@/core/container";
import type { LoginCoordinator, LoginOptions } from "@/login/loginCoordinator";

vi.mock("@/promptUtils", () => ({ maybeAskUrl: vi.fn() }));

const TEST_URL = "https://coder.example.com";
const TEST_HOSTNAME = "coder.example.com";

/** Append the deployment URL, which every route needs, to a query string. */
function withUrl(params: string): string {
	return `${params}&url=${encodeURIComponent(TEST_URL)}`;
}

const OPEN_QUERY = withUrl("owner=o&workspace=w");
const OPEN_DEV_CONTAINER_QUERY = withUrl(
	"owner=o&workspace=w&agent=a&devContainerName=c&devContainerFolder=/f",
);

const TRUST_PROMPT = "Open workspace from an unknown Coder deployment?";

/** Assert the unknown-deployment trust prompt was shown with this detail. */
function expectTrustPrompt(detail: unknown) {
	expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
		TRUST_PROMPT,
		{ useCustom: true, modal: true, detail },
		"Trust and Continue",
	);
}

/** Assert the URI failed with an error dialog containing this text. */
function expectUriError(detail: string) {
	expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
		"Failed to handle URI",
		expect.objectContaining({ detail: expect.stringContaining(detail) }),
	);
}

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
	const mementoManager = new MementoManager(memento);
	const secretsManager = new SecretsManager(
		secretStorage,
		mementoManager,
		logger,
	);
	const oauthCallback = new OAuthCallback(secretStorage, logger);
	const loginCoordinator = createMockLoginCoordinator(secretsManager);
	const commands = new MockCommands();
	const deploymentManager = new MockDeploymentManager();

	const container = {
		getSecretsManager: () => secretsManager,
		getMementoManager: () => mementoManager,
		getLoginCoordinator: () => loginCoordinator as unknown as LoginCoordinator,
		getContextManager: () => new MockContextManager(),
		getOAuthCallback: () => oauthCallback,
		getLogger: () => logger,
		getTelemetryService: () => NOOP_TELEMETRY_REPORTER,
	} as unknown as ServiceContainer;

	vi.mocked(maybeAskUrl).mockImplementation((_m, urlParam) =>
		Promise.resolve(urlParam || TEST_URL),
	);

	let registeredHandler: vscode.UriHandler["handleUri"] | null = null;
	vi.mocked(vscode.window.registerUriHandler).mockImplementation((handler) => {
		registeredHandler = handler.handleUri;
		return { dispose: vi.fn() };
	});

	const userInteraction = new MockUserInteraction();
	userInteraction.setResponse(TRUST_PROMPT, "Trust and Continue");

	registerUriHandler({
		serviceContainer: container,
		deploymentManager,
		commands,
	});

	return {
		commands,
		deploymentManager,
		loginCoordinator,
		secretsManager,
		oauthCallback,
		logger,
		userInteraction,
		showErrorMessage: vi.mocked(vscode.window.showErrorMessage),
		showWarningMessage: vi.mocked(vscode.window.showWarningMessage),
		handleUri: registeredHandler!,

		/** Handle one deep link, defaulting to the standard /open link. */
		open: (query: string = OPEN_QUERY, path = "/open") =>
			registeredHandler!(createMockUri(path, query)),

		/** Store a session, which is what makes a deployment known. */
		storeSession: (auth?: { url?: string; token?: string }) =>
			secretsManager.setSessionAuth(TEST_HOSTNAME, {
				url: TEST_URL,
				token: "known-token",
				...auth,
			}),

		/** Everything written to the logger, for leak assertions. */
		loggedOutput: () =>
			(
				[logger.debug, logger.info, logger.warn] as ReadonlyArray<
					(...args: unknown[]) => void
				>
			)
				.flatMap((method) => vi.mocked(method).mock.calls)
				.map((call) => JSON.stringify(call))
				.join("\n"),
	};
}

describe("uriHandler", () => {
	beforeEach(() => vi.resetAllMocks());

	it("registers a URI handler", () => {
		createTestContext();
		expect(vscode.window.registerUriHandler).toHaveBeenCalledOnce();
	});

	describe("/open", () => {
		// Fields the URI handler always supplies; per-test overrides spread on top.
		const OPEN_DEFAULTS = {
			source: "uri",
			useDefaultDirectory: false,
			workspaceOwner: "o",
			workspaceName: "w",
			agentName: undefined,
			folderPath: undefined,
			openRecent: false,
		};

		it("opens workspace with parameters", async () => {
			const t = createTestContext();

			await t.open(
				withUrl("owner=o&workspace=w&agent=a&folder=/f&openRecent=true"),
			);

			expect(t.deploymentManager.setDeployment).toHaveBeenCalled();
			expect(t.commands.open).toHaveBeenCalledWith({
				...OPEN_DEFAULTS,
				agentName: "a",
				folderPath: "/f",
				openRecent: true,
			});
		});

		it.each([
			["openRecent=true", true],
			["openRecent", true],
			["openRecent=false", false],
			["", false],
		])("handles %s -> %s", async (param, expected) => {
			const t = createTestContext();

			await t.open(withUrl(`owner=o&workspace=w&${param}`));

			expect(t.commands.open).toHaveBeenCalledWith({
				...OPEN_DEFAULTS,
				openRecent: expected,
			});
		});

		interface UnknownParamsCase {
			name: string;
			params: string;
		}

		it.each<UnknownParamsCase>([
			{ name: "from an older server (chatId)", params: "chatId=stale-123" },
			{
				name: "from a newer server",
				params: "someFutureFlag=1&anotherParam=v",
			},
		])("ignores unknown query params $name", async ({ params }) => {
			const t = createTestContext();

			await t.open(withUrl(`owner=o&workspace=w&${params}`));

			expect(t.deploymentManager.setDeployment).toHaveBeenCalled();
			expect(t.commands.open).toHaveBeenCalledWith(OPEN_DEFAULTS);
			expect(t.showErrorMessage).not.toHaveBeenCalled();
		});
	});

	describe("/openDevContainer", () => {
		it("opens dev container with parameters", async () => {
			const t = createTestContext();

			await t.open(
				`${OPEN_DEV_CONTAINER_QUERY}&localWorkspaceFolder=/l&localConfigFile=/cfg`,
				"/openDevContainer",
			);

			expect(t.deploymentManager.setDeployment).toHaveBeenCalled();
			expect(t.commands.openDevContainer).toHaveBeenCalledWith(
				"o",
				"w",
				"a",
				"c",
				"/f",
				"/l",
				"/cfg",
			);
		});

		it("ignores unknown query params", async () => {
			const t = createTestContext();

			await t.open(
				`${OPEN_DEV_CONTAINER_QUERY}&legacyExtra=1&someFutureFlag=on`,
				"/openDevContainer",
			);

			expect(t.commands.openDevContainer).toHaveBeenCalledWith(
				"o",
				"w",
				"a",
				"c",
				"/f",
				"",
				"",
			);
			expect(t.showErrorMessage).not.toHaveBeenCalled();
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
			const t = createTestContext();

			await t.open(withUrl(query), path);

			expectUriError(`${param} must be specified`);
		});

		it("throws when localConfigFile provided without localWorkspaceFolder", async () => {
			const t = createTestContext();

			await t.open(
				`${OPEN_DEV_CONTAINER_QUERY}&localConfigFile=/cfg`,
				"/openDevContainer",
			);

			expectUriError("localWorkspaceFolder must be specified");
		});

		it("throws for unknown path", async () => {
			const t = createTestContext();

			await t.open("", "/unknown");

			expectUriError("Unknown path");
		});
	});

	describe("deployment setup", () => {
		interface RouteCase {
			path: string;
			query: string;
			command: "open" | "openDevContainer";
		}

		it.each<RouteCase>([
			{ path: "/open", query: OPEN_QUERY, command: "open" },
			{
				path: "/openDevContainer",
				query: OPEN_DEV_CONTAINER_QUERY,
				command: "openDevContainer",
			},
		])(
			"asks for confirmation before using an unknown deployment for $path",
			async ({ path, query, command }) => {
				const t = createTestContext();

				await t.open(query, path);

				expectTrustPrompt(
					expect.stringMatching(
						new RegExp(
							`${TEST_URL}.*workspace "o/w".*not logged in.*SSH configuration`,
							"is",
						),
					),
				);
				expect(t.loginCoordinator.ensureLoggedIn).toHaveBeenCalledOnce();
				expect(t.deploymentManager.setDeployment).toHaveBeenCalledOnce();
				expect(t.commands[command]).toHaveBeenCalledOnce();
			},
		);

		it("discloses the token sign-in in the trust prompt and skips the second prompt", async () => {
			const t = createTestContext();

			await t.open(`${OPEN_QUERY}&token=tok`);

			expectTrustPrompt(
				expect.stringContaining("It contains a token that will sign you in."),
			);
			expect(t.loginCoordinator.ensureLoggedIn).toHaveBeenCalledWith(
				expect.objectContaining({ token: "tok", tokenSignInConfirmed: true }),
			);
		});

		interface NoSignInCase {
			name: string;
			query: string;
		}

		it.each<NoSignInCase>([
			{ name: "the link has no token", query: OPEN_QUERY },
			{ name: "the token is empty", query: `${OPEN_QUERY}&token=` },
		])("does not claim a sign-in when $name", async ({ query }) => {
			const t = createTestContext();

			await t.open(query);

			expectTrustPrompt(expect.not.stringContaining("token"));
			expect(t.loginCoordinator.ensureLoggedIn).toHaveBeenCalledWith(
				expect.objectContaining({ tokenSignInConfirmed: false }),
			);
		});

		it("cancels cleanly when the unknown deployment is not trusted", async () => {
			const t = createTestContext();
			t.userInteraction.setResponse(TRUST_PROMPT, undefined);

			await t.open(`${OPEN_QUERY}&token=secret-token`);

			expect(t.loginCoordinator.ensureLoggedIn).not.toHaveBeenCalled();
			expect(t.deploymentManager.setDeployment).not.toHaveBeenCalled();
			expect(t.commands.open).not.toHaveBeenCalled();
			expect(t.commands.openDevContainer).not.toHaveBeenCalled();
			expect(t.showErrorMessage).not.toHaveBeenCalled();
		});

		interface KnownDeploymentCase {
			path: string;
			query: string;
			token: string;
		}

		it.each<KnownDeploymentCase>([
			{ path: "/open", query: OPEN_QUERY, token: "known-token" },
			{ path: "/openDevContainer", query: OPEN_DEV_CONTAINER_QUERY, token: "" },
		])(
			"does not prompt for a known deployment on $path with token $token",
			async ({ path, query, token }) => {
				const t = createTestContext();
				await t.storeSession({ token });

				await t.open(query, path);

				expect(t.showWarningMessage).not.toHaveBeenCalled();
				expect(t.loginCoordinator.ensureLoggedIn).toHaveBeenCalledWith(
					expect.objectContaining({ tokenSignInConfirmed: false }),
				);
			},
		);

		interface LookalikeOriginCase {
			name: string;
			storedUrl: string;
		}

		it.each<LookalikeOriginCase>([
			{ name: "a different scheme", storedUrl: "http://coder.example.com" },
			{ name: "a different port", storedUrl: "https://coder.example.com:8443" },
		])(
			"prompts when the stored session is for $name ($storedUrl)",
			async ({ storedUrl }) => {
				const t = createTestContext();
				await t.storeSession({ url: storedUrl });

				await t.open();

				expectTrustPrompt(expect.stringContaining(TEST_URL));
			},
		);

		it("cancels cleanly when the user dismisses the login flow", async () => {
			const t = createTestContext();
			t.loginCoordinator.ensureLoggedIn.mockResolvedValueOnce({
				success: false,
				reason: "user_dismissed",
			});

			await t.open();

			expect(t.deploymentManager.setDeployment).not.toHaveBeenCalled();
			expect(t.commands.open).not.toHaveBeenCalled();
			expect(t.showErrorMessage).not.toHaveBeenCalled();
		});

		it("does not consider a deployment known after a failed login", async () => {
			const t = createTestContext();
			t.loginCoordinator.ensureLoggedIn
				.mockResolvedValueOnce({ success: false })
				.mockResolvedValueOnce({
					success: true,
					token: "test-token",
					user: createMockUser(),
				});

			await t.open();
			expect(t.showErrorMessage).toHaveBeenCalledOnce();

			await t.open();

			expect(t.showWarningMessage).toHaveBeenCalledTimes(2);
		});

		it("shows the full normalized deployment URL in the trust prompt", async () => {
			const t = createTestContext();
			vi.mocked(maybeAskUrl).mockResolvedValue(TEST_URL);

			await t.open("owner=o&workspace=w&url=coder.example.com%2F%2F%2F");

			expectTrustPrompt(expect.stringContaining(TEST_URL));
		});

		it("does not expose the URI token or editor URI in the trust prompt or logs", async () => {
			const t = createTestContext();

			await t.open(`${OPEN_QUERY}&token=secret-token`);

			const output = [
				t.loggedOutput(),
				JSON.stringify(t.showWarningMessage.mock.calls),
			].join("\n");
			expect(output).toContain(TEST_URL);
			expect(output).not.toContain("secret-token");
			expect(output).not.toContain("token=");
			expect(output).not.toContain("vscode://coder.coder-remote");
		});

		it("stores token from URI", async () => {
			const t = createTestContext();

			await t.open(`${OPEN_QUERY}&token=tok`);

			expect(await t.secretsManager.getSessionAuth(TEST_HOSTNAME)).toEqual({
				url: TEST_URL,
				token: "tok",
			});
		});

		it("throws on login failure", async () => {
			const t = createTestContext();
			t.loginCoordinator.ensureLoggedIn.mockResolvedValue({ success: false });

			await t.open();

			expectUriError("Failed to login");
		});

		it("throws when URL cancelled", async () => {
			const t = createTestContext();
			vi.mocked(maybeAskUrl).mockResolvedValue(undefined);

			await t.open("owner=o&workspace=w");

			expectUriError("url must be provided");
		});
	});

	describe("error handling", () => {
		it("logs and shows error message", async () => {
			const t = createTestContext();

			await t.open("workspace=w");

			expect(t.logger.warn).toHaveBeenCalledWith(
				"Failed to handle URI",
				expect.objectContaining({
					error: expect.stringContaining("owner must be specified"),
				}),
			);
			expect(t.showErrorMessage).toHaveBeenCalled();
		});

		it("does not log URI tokens on failure", async () => {
			const t = createTestContext();
			t.commands.open.mockRejectedValue(new Error("Connection failed"));

			await t.open(`${OPEN_QUERY}&token=secret-token`);

			expect(t.logger.warn).toHaveBeenCalledWith(
				"Failed to handle URI",
				expect.objectContaining({ error: "Connection failed" }),
			);
			const logged = t.loggedOutput();
			expect(logged).not.toContain("secret-token");
			expect(logged).not.toContain("token=");
			expect(logged).not.toContain("vscode://coder.coder-remote");
		});

		it("propagates command errors", async () => {
			const t = createTestContext();
			t.commands.open.mockRejectedValue(new Error("Connection failed"));

			await t.open();

			expectUriError("Connection failed");
		});
	});

	describe(CALLBACK_PATH, () => {
		interface CallbackData {
			state: string;
			code: string | null;
			error: string | null;
		}

		it("stores OAuth callback with code and state without a trust prompt", async () => {
			const { handleUri, oauthCallback, showWarningMessage } =
				createTestContext();

			const callbackPromise = new Promise<CallbackData>((resolve) => {
				oauthCallback.onReceive(resolve);
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
			expect(showWarningMessage).not.toHaveBeenCalled();
		});

		it("stores OAuth callback with error", async () => {
			const { handleUri, oauthCallback } = createTestContext();

			const callbackPromise = new Promise<CallbackData>((resolve) => {
				oauthCallback.onReceive(resolve);
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
			const { handleUri, oauthCallback } = createTestContext();

			let callbackReceived = false;
			oauthCallback.onReceive(() => {
				callbackReceived = true;
			});

			await handleUri(createMockUri(CALLBACK_PATH, "code=auth-code"));

			// Flush microtask queue to ensure any async callback would have fired
			await Promise.resolve();

			expect(callbackReceived).toBe(false);
		});
	});
});
