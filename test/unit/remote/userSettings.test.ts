import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applySettingOverrides } from "@/remote/userSettings";

import { createMockLogger } from "../../mocks/testHelpers";

describe("applySettingOverrides", () => {
	let tmpDir: string;
	let settingsPath: string;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "userSettings-test-"));
		settingsPath = path.join(tmpDir, "settings.json");
		logger = createMockLogger();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	async function readSettings(): Promise<Record<string, unknown>> {
		return JSON.parse(await fs.readFile(settingsPath, "utf8")) as Record<
			string,
			unknown
		>;
	}

	async function apply(
		overrides: Array<{ key: string; value: unknown }>,
		opts?: { initialContent?: string; readOnly?: boolean },
	): Promise<boolean> {
		if (opts?.initialContent !== undefined) {
			await fs.writeFile(settingsPath, opts.initialContent);
		}
		if (opts?.readOnly) {
			await fs.chmod(settingsPath, 0o444);
		}
		return applySettingOverrides(settingsPath, overrides, logger);
	}

	it("returns false when overrides list is empty", async () => {
		expect(await apply([])).toBe(false);
	});

	it("creates file and applies overrides when file does not exist", async () => {
		expect(
			await apply([
				{ key: "editor.fontSize", value: 14 },
				{ key: "editor.tabSize", value: 2 },
			]),
		).toBe(true);

		expect(await readSettings()).toMatchObject({
			"editor.fontSize": 14,
			"editor.tabSize": 2,
		});
	});

	it("preserves existing settings when applying overrides", async () => {
		expect(
			await apply([{ key: "editor.fontSize", value: 16 }], {
				initialContent: JSON.stringify({
					"editor.wordWrap": "on",
					"editor.fontSize": 12,
				}),
			}),
		).toBe(true);

		expect(await readSettings()).toMatchObject({
			"editor.wordWrap": "on",
			"editor.fontSize": 16,
		});
	});

	it("handles JSONC with comments", async () => {
		const jsonc = [
			"{",
			"  // This is a comment",
			'  "editor.fontSize": 12,',
			'  "editor.tabSize": 4',
			"}",
		].join("\n");

		await apply([{ key: "editor.fontSize", value: 18 }], {
			initialContent: jsonc,
		});

		const raw = await fs.readFile(settingsPath, "utf8");
		expect(raw).toContain("// This is a comment");
		expect(raw).toContain("18");
		expect(raw).toContain('"editor.tabSize": 4');
	});

	it("applies multiple overrides at once", async () => {
		expect(
			await apply(
				[
					{ key: "remote.SSH.remotePlatform", value: { myhost: "linux" } },
					{ key: "remote.SSH.connectTimeout", value: 1800 },
					{ key: "remote.SSH.reconnectionGraceTime", value: 28800 },
				],
				{ initialContent: "{}" },
			),
		).toBe(true);

		expect(await readSettings()).toMatchObject({
			"remote.SSH.remotePlatform": { myhost: "linux" },
			"remote.SSH.connectTimeout": 1800,
			"remote.SSH.reconnectionGraceTime": 28800,
		});
	});

	it("returns false and logs warning when file is read-only", async () => {
		expect(
			await apply([{ key: "editor.fontSize", value: 14 }], {
				initialContent: "{}",
				readOnly: true,
			}),
		).toBe(false);

		expect(logger.warn).toHaveBeenCalledWith(
			"Failed to configure settings",
			expect.anything(),
		);

		// Restore permissions for cleanup.
		await fs.chmod(settingsPath, 0o644);
	});
});
