import { isDeepStrictEqual } from "node:util";
import * as vscode from "vscode";

export interface WatchedSetting {
	setting: string;
	getValue: () => unknown;
}

/**
 * Watch for configuration changes and invoke a callback when values change.
 * Only fires when actual values change, not just when settings are touched.
 */
export function watchConfigurationChanges(
	settings: WatchedSetting[],
	onChange: (changedSettings: string[]) => void,
): vscode.Disposable {
	const appliedValues = new Map(settings.map((s) => [s.setting, s.getValue()]));

	return vscode.workspace.onDidChangeConfiguration((e) => {
		const changedSettings: string[] = [];

		for (const { setting, getValue } of settings) {
			if (!e.affectsConfiguration(setting)) {
				continue;
			}

			const newValue = getValue();

			if (!isDeepStrictEqual(newValue, appliedValues.get(setting))) {
				changedSettings.push(setting);
				appliedValues.set(setting, newValue);
			}
		}

		if (changedSettings.length > 0) {
			onChange(changedSettings);
		}
	});
}
