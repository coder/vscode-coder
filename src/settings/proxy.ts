import * as vscode from "vscode";

const LOCAL_PROXY_SETTINGS = [
	"http.proxy",
	"http.proxySupport",
	"http.noProxy",
	"http.proxyAuthorization",
	"http.proxyStrictSSL",
] as const;

/** The `http.*` proxy settings that the HTTP agent and SSH environment read. */
export type LocalProxySetting = (typeof LOCAL_PROXY_SETTINGS)[number];

/**
 * Local proxy settings for API requests and the SSH process. Without
 * `http.useLocalProxyConfiguration`, a connected remote window reads `http.*`
 * from the remote, so this keeps the last local values.
 */
export class LocalProxySettings implements vscode.Disposable {
	static #instance: LocalProxySettings | undefined;

	#local: ReadonlyMap<LocalProxySetting, unknown>;
	readonly #listener: vscode.Disposable;

	/** @throws Error if already initialized and not yet disposed. */
	public static initialize(): vscode.Disposable {
		if (LocalProxySettings.#instance) {
			throw new Error("LocalProxySettings has already been initialized");
		}
		LocalProxySettings.#instance = new LocalProxySettings();
		return LocalProxySettings.#instance;
	}

	/** @throws Error if not initialized. */
	public static get<T>(section: LocalProxySetting): T | undefined {
		const instance = LocalProxySettings.#instance;
		if (!instance) {
			throw new Error("LocalProxySettings has not been initialized");
		}
		return readsRemoteProxySettings()
			? (instance.#local.get(section) as T | undefined)
			: vscode.workspace.getConfiguration().get<T>(section);
	}

	private constructor() {
		this.#local = readProxySettings();
		this.#listener = vscode.workspace.onDidChangeConfiguration((e) => {
			if (
				!readsRemoteProxySettings() &&
				LOCAL_PROXY_SETTINGS.some((s) => e.affectsConfiguration(s))
			) {
				this.#local = readProxySettings();
			}
		});
	}

	public dispose(): void {
		this.#listener.dispose();
		if (LocalProxySettings.#instance === this) {
			LocalProxySettings.#instance = undefined;
		}
	}
}

function readProxySettings(): ReadonlyMap<LocalProxySetting, unknown> {
	const cfg = vscode.workspace.getConfiguration();
	return new Map(LOCAL_PROXY_SETTINGS.map((s) => [s, cfg.get(s)]));
}

function readsRemoteProxySettings(): boolean {
	return (
		vscode.env.remoteName !== undefined &&
		!vscode.workspace
			.getConfiguration()
			.get<boolean>("http.useLocalProxyConfiguration", true)
	);
}
