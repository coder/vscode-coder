import { vi } from "vitest";

// enum-like helpers
const E = <T extends Record<string, number>>(o: T) => Object.freeze(o);

export const ProgressLocation = E({
	SourceControl: 1,
	Window: 10,
	Notification: 15,
});
export const ViewColumn = E({
	Active: -1,
	Beside: -2,
	One: 1,
	Two: 2,
	Three: 3,
});
export const ConfigurationTarget = E({
	Global: 1,
	Workspace: 2,
	WorkspaceFolder: 3,
});
export const TreeItemCollapsibleState = E({
	None: 0,
	Collapsed: 1,
	Expanded: 2,
});
export const StatusBarAlignment = E({ Left: 1, Right: 2 });
export const ExtensionMode = E({ Production: 1, Development: 2, Test: 3 });
export const UIKind = E({ Desktop: 1, Web: 2 });

export class Uri {
	constructor(
		public scheme: string,
		public path: string,
	) {}
	static file(p: string) {
		return new Uri("file", p);
	}
	static parse(v: string) {
		if (v.startsWith("file://")) {
			return Uri.file(v.slice("file://".length));
		}
		const [scheme, ...rest] = v.split(":");
		return new Uri(scheme, rest.join(":"));
	}
	toString() {
		return this.scheme === "file"
			? `file://${this.path}`
			: `${this.scheme}:${this.path}`;
	}
	static joinPath(base: Uri, ...paths: string[]) {
		const sep = base.path.endsWith("/") ? "" : "/";
		return new Uri(base.scheme, base.path + sep + paths.join("/"));
	}
}

// mini event
const makeEvent = <T>() => {
	const listeners = new Set<(e: T) => void>();
	const event = (listener: (e: T) => void) => {
		listeners.add(listener);
		return { dispose: () => listeners.delete(listener) };
	};
	return { event, fire: (e: T) => listeners.forEach((l) => l(e)) };
};

const onDidChangeConfiguration = makeEvent<unknown>();
const onDidChangeWorkspaceFolders = makeEvent<unknown>();

export const window = {
	showInformationMessage: vi.fn(),
	showWarningMessage: vi.fn(),
	showErrorMessage: vi.fn(),
	showQuickPick: vi.fn(),
	showInputBox: vi.fn(),
	withProgress: vi.fn(),
	createOutputChannel: vi.fn(() => ({
		appendLine: vi.fn(),
		append: vi.fn(),
		show: vi.fn(),
		hide: vi.fn(),
		dispose: vi.fn(),
		clear: vi.fn(),
	})),
};

export const commands = {
	registerCommand: vi.fn(),
	executeCommand: vi.fn(),
};

export const workspace = {
	getConfiguration: vi.fn(), // your helpers override this
	workspaceFolders: [] as unknown[],
	fs: {
		readFile: vi.fn(),
		writeFile: vi.fn(),
		stat: vi.fn(),
		readDirectory: vi.fn(),
	},
	onDidChangeConfiguration: onDidChangeConfiguration.event,
	onDidChangeWorkspaceFolders: onDidChangeWorkspaceFolders.event,

	// test-only triggers:
	__fireDidChangeConfiguration: onDidChangeConfiguration.fire,
	__fireDidChangeWorkspaceFolders: onDidChangeWorkspaceFolders.fire,
};

export const env = {
	appName: "Visual Studio Code",
	appRoot: "/app",
	language: "en",
	machineId: "test-machine-id",
	sessionId: "test-session-id",
	remoteName: undefined as string | undefined,
	shell: "/bin/bash",
	openExternal: vi.fn(),
};

export const extensions = {
	getExtension: vi.fn(),
	all: [] as unknown[],
};

const vscode = {
	ProgressLocation,
	ViewColumn,
	ConfigurationTarget,
	TreeItemCollapsibleState,
	StatusBarAlignment,
	ExtensionMode,
	UIKind,
	Uri,
	window,
	commands,
	workspace,
	env,
	extensions,
};

export default vscode;
