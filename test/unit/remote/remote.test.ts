import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { MementoManager } from "@/core/mementoManager";
import { PathResolver } from "@/core/pathResolver";
import { SecretsManager } from "@/core/secretsManager";
import { Remote } from "@/remote/remote";

import { createTestTelemetryService } from "../../mocks/telemetry";
import {
	createMockLogger,
	InMemoryMemento,
	InMemorySecretStorage,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type { Commands } from "@/commands";
import type { CliManager } from "@/core/cliManager";
import type { ServiceContainer } from "@/core/container";
import type { ContextManager } from "@/core/contextManager";
import type { LoginCoordinator } from "@/login/loginCoordinator";

const SAFE_HOSTNAME = "coder.example.com";
const REMOTE_AUTHORITY =
	"ssh-remote+coder-vscode.coder.example.com--testuser--test-workspace.main";

describe("Remote", () => {
	let testDir: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		new MockConfigurationProvider();
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-test-"));
	});

	afterEach(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("ignores mismatched file auth and falls through to login", async () => {
		const pathResolver = new PathResolver(testDir, "/code/log");
		await fs.mkdir(pathResolver.getGlobalConfigDir(SAFE_HOSTNAME), {
			recursive: true,
		});
		await Promise.all([
			fs.writeFile(
				pathResolver.getUrlPath(SAFE_HOSTNAME),
				"https://cursor.example.com",
			),
			fs.writeFile(pathResolver.getSessionTokenPath(SAFE_HOSTNAME), "token"),
		]);

		const logger = createMockLogger();
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
		const remote = new Remote(
			serviceContainer,
			{} as Commands,
			{} as vscode.ExtensionContext,
		);

		await expect(
			remote.setup(REMOTE_AUTHORITY, "none", "anysphere.remote-ssh"),
		).resolves.toBeUndefined();

		expect(await secretsManager.getSessionAuth(SAFE_HOSTNAME)).toBeUndefined();
		expect(logger.warn).toHaveBeenCalledWith(
			"Failed to migrate session auth from files",
			{ safeHostname: SAFE_HOSTNAME },
		);
		expect(ensureLoggedInWithDialog).toHaveBeenCalledWith(
			expect.objectContaining({
				safeHostname: SAFE_HOSTNAME,
				trigger: "missing_session",
			}),
		);
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"workbench.action.remote.close",
		);
	});
});
