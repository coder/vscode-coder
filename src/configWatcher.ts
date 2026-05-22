import { isDeepStrictEqual } from "node:util";
import * as vscode from "vscode";

/**
 * Debounce window for config-change reactions that fan out (recovery,
 * reconnect, reload prompts). Keeps rapid edits in settings.json from
 * flushing each side-effect per keystroke.
 */
export const CONFIG_CHANGE_DEBOUNCE_MS = 250;

export interface WatchedSetting {
	setting: string;
	getValue: () => unknown;
}

export interface WatchConfigurationChangesOptions {
	debounceMs?: number;
}

/**
 * Watch for configuration changes and invoke a callback when values change.
 * Fires only when actual values change. With `debounceMs`, the first event
 * opens a fixed collection window; subsequent events during the window are
 * coalesced. This bounds latency even when events arrive faster than the
 * window length (a reset-style debounce would starve).
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

	let windowTimer: ReturnType<typeof setTimeout> | undefined;
	const listener = vscode.workspace.onDidChangeConfiguration((e) => {
		if (!settings.some((s) => e.affectsConfiguration(s.setting))) {
			return;
		}
		if (!options.debounceMs) {
			detectAndFire();
			return;
		}
		if (windowTimer) {
			return; // already collecting in the open window
		}
		windowTimer = setTimeout(() => {
			windowTimer = undefined;
			detectAndFire();
		}, options.debounceMs);
	});

	return {
		dispose: () => {
			clearTimeout(windowTimer);
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
