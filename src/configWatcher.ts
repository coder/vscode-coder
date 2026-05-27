import { isDeepStrictEqual } from "node:util";
import * as vscode from "vscode";

/** Idle window for config-change reactions. Coalesces rapid edits into one fire. */
export const CONFIG_CHANGE_DEBOUNCE_MS = 200;

export interface WatchedSetting {
	setting: string;
	getValue: () => unknown;
}

export interface WatchConfigurationChangesOptions {
	/**
	 * Idle window in ms. Each new event resets the timer; the callback
	 * fires once settings have been quiet for this long. Unset means fire
	 * synchronously on every event.
	 */
	debounceMs?: number;
}

/**
 * Watch for configuration changes and fire when watched values change.
 * With `debounceMs`, defers until settings have been quiet for that long.
 */
export function watchConfigurationChanges(
	settings: WatchedSetting[],
	onChange: (changes: ReadonlyMap<string, unknown>) => void,
	options: WatchConfigurationChangesOptions = {},
): vscode.Disposable {
	const appliedValues = new Map(settings.map((s) => [s.setting, s.getValue()]));

	const detectAndFire = () => {
		const changes = new Map<string, unknown>();
		for (const { setting, getValue } of settings) {
			const newValue = getValue();
			if (!configValuesEqual(newValue, appliedValues.get(setting))) {
				changes.set(setting, newValue);
				appliedValues.set(setting, newValue);
			}
		}
		if (changes.size > 0) {
			onChange(changes);
		}
	};

	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const listener = vscode.workspace.onDidChangeConfiguration((e) => {
		if (!settings.some((s) => e.affectsConfiguration(s.setting))) {
			return;
		}
		if (!options.debounceMs) {
			detectAndFire();
			return;
		}
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			idleTimer = undefined;
			detectAndFire();
		}, options.debounceMs);
	});

	return {
		dispose: () => {
			clearTimeout(idleTimer);
			listener.dispose();
		},
	};
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
