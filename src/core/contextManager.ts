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

	public constructor() {
		(Object.keys(CONTEXT_DEFAULTS) as CoderContext[]).forEach((key) => {
			this.set(key, CONTEXT_DEFAULTS[key]);
		});
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
