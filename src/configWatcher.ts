import { isDeepStrictEqual } from "node:util";
import * as vscode from "vscode";

export interface WatchedSetting {
	setting: string;
	getValue: () => unknown;
}

/**
 * Watch for configuration changes and invoke a callback when values change.
 * The callback receives a map of changed settings to their new values, so
 * consumers can act on the new value without re-reading the configuration.
 * Only fires when actual values change, not just when settings are touched.
 */
export function watchConfigurationChanges(
	settings: WatchedSetting[],
	onChange: (changes: ReadonlyMap<string, unknown>) => void,
): vscode.Disposable {
	const appliedValues = new Map(settings.map((s) => [s.setting, s.getValue()]));

	return vscode.workspace.onDidChangeConfiguration((e) => {
		const changes = new Map<string, unknown>();

		for (const { setting, getValue } of settings) {
			if (!e.affectsConfiguration(setting)) {
				continue;
			}

			const newValue = getValue();

			if (!configValuesEqual(newValue, appliedValues.get(setting))) {
				changes.set(setting, newValue);
				appliedValues.set(setting, newValue);
			}
		}

		if (changes.size > 0) {
			onChange(changes);
		}
	});
}

function configValuesEqual(a: unknown, b: unknown): boolean {
	return isDeepStrictEqual(normalizeEmptyValue(a), normalizeEmptyValue(b));
}

/**
 * Normalize empty values (undefined, null, "", []) to a canonical form for comparison.
 */
function normalizeEmptyValue(value: unknown): unknown {
	if (
		value === undefined ||
		value === null ||
		value === "" ||
		(Array.isArray(value) && value.length === 0)
	) {
		return undefined;
	}
	return value;
}
