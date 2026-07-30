import { vol } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { PathResolver } from "@/core/pathResolver";
import { Remote } from "@/remote/remote";

import { createTestTelemetryService } from "../../mocks/telemetry";
import {
	createMockLogger,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type * as nodeFs from "node:fs";
import type * as vscode from "vscode";

import type { Commands } from "@/commands";
import type { ServiceContainer } from "@/core/container";
import type { SecretsManager, SessionAuth } from "@/core/secretsManager";

vi.mock("fs/promises", async () => {
	const memfs: { fs: typeof nodeFs } = await vi.importActual("memfs");
	return {
		...memfs.fs.promises,
		default: memfs.fs.promises,
	};
});

const BASE_PATH = "/base";
const HOSTNAME = "dep.example.com";
const URL_PATH = `${BASE_PATH}/${HOSTNAME}/url`;
const TOKEN_PATH = `${BASE_PATH}/${HOSTNAME}/session`;

interface MigratableRemote {
	migrateToSecretsStorage(safeHostname: string): Promise<void>;
}

function setup(options: { existingAuth?: SessionAuth } = {}) {
	vi.clearAllMocks();
	vol.reset();
	new MockConfigurationProvider();

	const logger = createMockLogger();
	const pathResolver = new PathResolver(BASE_PATH, "/logs/code");
	const secretsManager: Pick<
		SecretsManager,
		"getSessionAuth" | "setSessionAuth"
	> = {
		getSessionAuth: vi.fn(() => Promise.resolve(options.existingAuth)),
		setSessionAuth: vi.fn(() => Promise.resolve()),
	};

	const serviceContainer = {
		getLogger: () => logger,
		getPathResolver: () => pathResolver,
		getCliManager: () => ({}),
		getContextManager: () => ({}),
		getSecretsManager: () => secretsManager,
		getLoginCoordinator: () => ({}),
		getTelemetryService: () => createTestTelemetryService(),
	} as unknown as ServiceContainer;

	const remote = new Remote(
		serviceContainer,
		{} as Commands,
		{} as vscode.ExtensionContext,
	) as unknown as MigratableRemote;

	return { remote, secretsManager };
}

function writeLegacyFiles(): void {
	vol.fromJSON({
		[URL_PATH]: "https://dep.example.com\n",
		[TOKEN_PATH]: "legacy-token\n",
	});
}

describe("Remote session auth migration", () => {
	it("moves file-based auth into secret storage and deletes the files", async () => {
		const { remote, secretsManager } = setup();
		writeLegacyFiles();

		await remote.migrateToSecretsStorage(HOSTNAME);

		expect(secretsManager.setSessionAuth).toHaveBeenCalledWith(HOSTNAME, {
			url: "https://dep.example.com",
			token: "legacy-token",
		});
		expect(vol.existsSync(URL_PATH)).toBe(false);
		expect(vol.existsSync(TOKEN_PATH)).toBe(false);
	});

	it("deletes the files even when the migration is rejected", async () => {
		const { remote, secretsManager } = setup();
		vi.mocked(secretsManager.setSessionAuth).mockRejectedValue(
			new Error("Session auth hostname mismatch"),
		);
		writeLegacyFiles();

		await remote.migrateToSecretsStorage(HOSTNAME);

		expect(vol.existsSync(URL_PATH)).toBe(false);
		expect(vol.existsSync(TOKEN_PATH)).toBe(false);
	});

	it("does not migrate or delete files when auth already exists", async () => {
		const { remote, secretsManager } = setup({
			existingAuth: { url: "https://dep.example.com", token: "current" },
		});
		writeLegacyFiles();

		await remote.migrateToSecretsStorage(HOSTNAME);

		expect(secretsManager.setSessionAuth).not.toHaveBeenCalled();
		expect(vol.existsSync(URL_PATH)).toBe(true);
		expect(vol.existsSync(TOKEN_PATH)).toBe(true);
	});

	it("does nothing when the legacy files are missing", async () => {
		const { remote, secretsManager } = setup();

		await remote.migrateToSecretsStorage(HOSTNAME);

		expect(secretsManager.setSessionAuth).not.toHaveBeenCalled();
	});
});
