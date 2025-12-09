import * as vscode from "vscode";

const CONTEXT_DEFAULTS = {
	"coder.authenticated": false,
	"coder.isOwner": false,
	"coder.loaded": false,
	"coder.workspace.updatable": false,
} as const;

type CoderContext = keyof typeof CONTEXT_DEFAULTS;

export class ContextManager implements vscode.Disposable {
	private readonly context = new Map<CoderContext, boolean>();

	public constructor(extensionContext: vscode.ExtensionContext) {
		for (const key of Object.keys(CONTEXT_DEFAULTS) as CoderContext[]) {
			this.set(key, CONTEXT_DEFAULTS[key]);
		}
		this.setInternalContexts(extensionContext);
	}

	private setInternalContexts(extensionContext: vscode.ExtensionContext): void {
		vscode.commands.executeCommand(
			"setContext",
			"coder.devMode",
			extensionContext.extensionMode === vscode.ExtensionMode.Development,
		);
	}

	public set(key: CoderContext, value: boolean): void {
		this.context.set(key, value);
		vscode.commands.executeCommand("setContext", key, value);
	}

	public get(key: CoderContext): boolean {
		return this.context.get(key) ?? CONTEXT_DEFAULTS[key];
	}

	public dispose() {
		this.context.clear();
	}
}
