import * as vscode from "vscode";

import {
	watchConfigurationChanges,
	type WatchedSetting,
} from "../configWatcher";

/**
 * Settings that affect how a request is authenticated (header command output
 * and mTLS material). A change to any of these invalidates an in-flight
 * session.
 */
const AUTH_CONFIG_SETTINGS = [
	"coder.headerCommand",
	"coder.tlsCertFile",
	"coder.tlsKeyFile",
	"coder.tlsCaFile",
	"coder.tlsAltHost",
] as const;

/** {@link AUTH_CONFIG_SETTINGS} packaged for `watchConfigurationChanges`. */
export function getAuthConfigWatchSettings(): WatchedSetting[] {
	return AUTH_CONFIG_SETTINGS.map((setting) => ({
		setting,
		getValue: () => vscode.workspace.getConfiguration().get(setting),
	}));
}

/**
 * Monotonic counter that ticks when an auth setting changes. The request
 * interceptor stamps each request with the current version; on a 401 the
 * auth interceptor retries once if the counter advanced in the meantime.
 */
export class AuthConfigTracker implements vscode.Disposable {
	#version = 0;
	readonly #disposable: vscode.Disposable;

	public constructor() {
		this.#disposable = watchConfigurationChanges(
			getAuthConfigWatchSettings(),
			() => {
				this.#version++;
			},
		);
	}

	public get version(): number {
		return this.#version;
	}

	public hasChangedSince(version: number | undefined): boolean {
		return version !== undefined && this.#version !== version;
	}

	public dispose(): void {
		this.#disposable.dispose();
	}
}
