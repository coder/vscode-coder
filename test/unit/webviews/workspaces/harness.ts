import { vi } from "vitest";
import * as vscode from "vscode";

import { WorkspacesPanelProvider } from "@/webviews/workspaces/panelProvider";
import { WorkspaceStore, type PollOptions } from "@/webviews/workspaces/store";

import {
	createMockLogger,
	createMockUser,
	createMockWebviewView,
	flushPromises,
	MockWorkspacesClient,
	TestSessionStore,
} from "../../../mocks/testHelpers";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";

import type { CommandDef, WorkspacesUpdate } from "@repo/shared";

export const DEPLOYMENT_URL = "https://coder.example.com";

export const DEPLOYMENT = {
	url: DEPLOYMENT_URL,
	safeHostname: "coder.example.com",
};

export const OWNER = createMockUser({
	roles: [{ name: "owner", display_name: "Owner" }],
});

/** Stands in for CoderApi at the boundaries the panel touches. */
export class MockClient extends MockWorkspacesClient {
	readonly getHost = vi.fn((): string | undefined => DEPLOYMENT_URL);
}

const disposables: vscode.Disposable[] = [];

/** Stop the pollers so their timers do not outlive the test. */
export function disposeHarnesses(): void {
	for (const disposable of disposables.splice(0)) {
		disposable.dispose();
	}
}

function createStoreWith(client: MockClient, options?: Partial<PollOptions>) {
	const session = new TestSessionStore();
	const store = new WorkspaceStore(
		// Cast needed: the mock implements only the CoderApi methods used here
		client as unknown as CoderApi,
		createMockLogger(),
		session,
		options,
	);
	disposables.push(store);

	const updates: WorkspacesUpdate[] = [];
	store.onDidChange((update) => updates.push(update));

	return {
		client,
		session,
		store,
		updates,
		/** Reveal the store, which lists, and wait for the fetch. */
		show: () => store.setVisible(true),
		/** The value of every push that carried `key`, oldest first. */
		pushes: <K extends keyof WorkspacesUpdate>(key: K) =>
			updates
				.filter((update) => update[key] !== undefined)
				.map((update) => update[key] as NonNullable<WorkspacesUpdate[K]>),
		last<K extends keyof WorkspacesUpdate>(key: K) {
			return this.pushes(key).at(-1);
		},
	};
}

export function createStore(options?: Partial<PollOptions>) {
	return createStoreWith(new MockClient(), options);
}

export function createPanel() {
	const client = new MockClient();
	const base = createStoreWith(client);
	const openWorkspace = vi.fn(
		(_workspace: Workspace, _agent: WorkspaceAgent | undefined) =>
			Promise.resolve(true),
	);
	const provider = new WorkspacesPanelProvider({
		extensionUri: vscode.Uri.file("/test/extension"),
		client: client as unknown as CoderApi,
		logger: createMockLogger(),
		store: base.store,
		openWorkspace,
	});
	disposables.push(provider);

	const { view, hooks } = createMockWebviewView(
		WorkspacesPanelProvider.viewType,
	);

	provider.resolveWebviewView(
		view,
		{} as vscode.WebviewViewResolveContext,
		new vscode.CancellationTokenSource().token,
	);

	return {
		...base,
		provider,
		view,
		openWorkspace,
		setVisible: hooks.setVisible,
		show: async () => {
			hooks.setVisible(true);
			await base.store.settled;
		},
		/** Send a command from the webview and wait for its handler. */
		send: async <P>(
			def: CommandDef<P>,
			...args: P extends void ? [] : [params: P]
		) => {
			hooks.sendFromWebview({ method: def.method, params: args[0] });
			await flushPromises();
			await base.store.settled;
		},
		/** Send anything the webview could post, valid or not. */
		sendRaw: async (message: unknown) => {
			hooks.sendFromWebview(message);
			await flushPromises();
		},
		/** Every state update pushed to the webview, oldest first. */
		pushedUpdates: () =>
			hooks.postedMessages
				.filter(
					(message) => (message as { type?: string }).type === "stateUpdated",
				)
				.map((message) => (message as { data: WorkspacesUpdate }).data),
		clearPushes: () => hooks.clearPostedMessages(),
	};
}
