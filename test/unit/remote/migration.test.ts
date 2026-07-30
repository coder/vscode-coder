import { vol } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { PathResolver } from "@/core/pathResolver";
import { migrateAuthToSecretsStorage } from "@/remote/migration";

import { createMockLogger } from "../../mocks/testHelpers";

import type * as nodeFs from "node:fs";

import type { SessionAuth } from "@/core/secretsManager";

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

function setup(options: { existingAuth?: SessionAuth } = {}) {
	vol.reset();
	const secretsManager = {
		getSessionAuth: vi.fn(() => Promise.resolve(options.existingAuth)),
		setSessionAuth: vi.fn(() => Promise.resolve()),
	};
	const migrate = () =>
		migrateAuthToSecretsStorage(
			HOSTNAME,
			new PathResolver(BASE_PATH, "/logs/code"),
			secretsManager,
			createMockLogger(),
		);
	return { migrate, secretsManager };
}

function writeLegacyFiles(): void {
	vol.fromJSON({
		[URL_PATH]: "https://dep.example.com\n",
		[TOKEN_PATH]: "legacy-token\n",
	});
}

describe("Session auth migration", () => {
	it("moves file-based auth into secret storage and deletes the files", async () => {
		const { migrate, secretsManager } = setup();
		writeLegacyFiles();

		await migrate();

		expect(secretsManager.setSessionAuth).toHaveBeenCalledWith(HOSTNAME, {
			url: "https://dep.example.com",
			token: "legacy-token",
		});
		expect(vol.existsSync(URL_PATH)).toBe(false);
		expect(vol.existsSync(TOKEN_PATH)).toBe(false);
	});

	it("deletes the files even when the migration is rejected", async () => {
		const { migrate, secretsManager } = setup();
		secretsManager.setSessionAuth.mockRejectedValue(
			new Error("Session auth hostname mismatch"),
		);
		writeLegacyFiles();

		await migrate();

		expect(vol.existsSync(URL_PATH)).toBe(false);
		expect(vol.existsSync(TOKEN_PATH)).toBe(false);
	});

	it("does not migrate or delete files when auth already exists", async () => {
		const { migrate, secretsManager } = setup({
			existingAuth: { url: "https://dep.example.com", token: "current" },
		});
		writeLegacyFiles();

		await migrate();

		expect(secretsManager.setSessionAuth).not.toHaveBeenCalled();
		expect(vol.existsSync(URL_PATH)).toBe(true);
		expect(vol.existsSync(TOKEN_PATH)).toBe(true);
	});

	it("does nothing when the legacy files are missing", async () => {
		const { migrate, secretsManager } = setup();

		await migrate();

		expect(secretsManager.setSessionAuth).not.toHaveBeenCalled();
	});
});
