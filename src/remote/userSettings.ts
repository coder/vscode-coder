import * as jsonc from "jsonc-parser";
import * as fs from "node:fs/promises";

import { type Logger } from "../logging/logger";

export interface SettingOverride {
	key: string;
	value: unknown;
}

/**
 * Apply setting overrides to the user's settings.json file.
 *
 * We munge the file directly with jsonc instead of using the VS Code API
 * because the API hangs indefinitely during remote connection setup (likely
 * a deadlock from trying to update config on the not-yet-connected remote).
 */
export async function applySettingOverrides(
	settingsFilePath: string,
	overrides: SettingOverride[],
	logger: Logger,
): Promise<boolean> {
	if (overrides.length === 0) {
		return false;
	}

	let settingsContent = "{}";
	try {
		settingsContent = await fs.readFile(settingsFilePath, "utf8");
	} catch {
		// File probably doesn't exist yet.
	}

	for (const { key, value } of overrides) {
		settingsContent = jsonc.applyEdits(
			settingsContent,
			jsonc.modify(settingsContent, [key], value, {}),
		);
	}

	try {
		await fs.writeFile(settingsFilePath, settingsContent);
		return true;
	} catch (ex) {
		// Could be read-only (e.g. home-manager on NixOS). Not catastrophic.
		logger.warn("Failed to configure settings", ex);
		return false;
	}
}
