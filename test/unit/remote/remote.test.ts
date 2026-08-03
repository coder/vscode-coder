import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MementoManager } from "@/core/mementoManager";
import { PathResolver } from "@/core/pathResolver";
import { SecretsManager } from "@/core/secretsManager";
import { Remote } from "@/remote/remote";

import { createTestTelemetryService } from "../../mocks/telemetry";
import {
	createMockLogger,
	InMemoryMemento,
	InMemorySecretStorage,
	LogCollector,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type * as vscode from "vscode";

import type { Commands } from "@/commands";
import type { CliManager } from "@/core/cliManager";
import type { ServiceContainer } from "@/core/container";
import type { ContextManager } from "@/core/contextManager";
import type { Logger } from "@/logging/logger";
import type { LoginCoordinator } from "@/login/loginCoordinator";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const SAFE_HOSTNAME = "coder.example.com";
const REMOTE_AUTHORITY =
	"ssh-remote+coder-vscode.coder.example.com--testuser--test-workspace.main";
const MISMATCHED_URL =
	"https://cursor.example.com/private?token=sensitive-url-token";
const SESSION_TOKEN = "sensitive-session-token";

function createRemote(logger: Logger = createMockLogger()) {
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
	const serviceContainer = {
		getLogger: () => logger,
		getPathResolver: () => pathResolver,
		getCliManager: () => ({}) as CliManager,
		getContextManager: () => ({}) as ContextManager,
		getSecretsManager: () => secretsManager,
		getLoginCoordinator: () =>
			({ ensureLoggedInWithDialog }) as unknown as LoginCoordinator,
		getTelemetryService: () => createTestTelemetryService(),
	} as ServiceContainer;

	return {
		remote: new Remote(
			serviceContainer,
			{} as Commands,
			{} as vscode.ExtensionContext,
		),
		secretsManager,
	};
}

describe("Remote", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vol.reset();
		new MockConfigurationProvider();
	});

	it("ignores mismatched file auth", async () => {
		const { remote, secretsManager } = createRemote();

		await expect(
			remote.setup(REMOTE_AUTHORITY, "none", "anysphere.remote-ssh"),
		).resolves.toBeUndefined();
		expect(await secretsManager.getSessionAuth(SAFE_HOSTNAME)).toBeUndefined();
	});

	describe("logging", () => {
		it("sanitizes the file auth migration warning", async () => {
			const logs = new LogCollector();
			const { remote } = createRemote(logs);

			await remote.setup(REMOTE_AUTHORITY, "none", "anysphere.remote-ssh");

			const warning = logs.entries.find(
				(entry) =>
					entry.level === "warn" &&
					entry.message === "Failed to migrate session auth from files",
			);
			expect(warning).toEqual({
				level: "warn",
				message: "Failed to migrate session auth from files",
				args: [{ safeHostname: SAFE_HOSTNAME }],
			});
			expect(JSON.stringify(warning)).not.toContain(MISMATCHED_URL);
			expect(JSON.stringify(warning)).not.toContain(SESSION_TOKEN);
		});
	});
});
