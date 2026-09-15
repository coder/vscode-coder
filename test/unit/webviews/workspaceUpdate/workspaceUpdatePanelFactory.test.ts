import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { DynamicUpdateSession } from "@/api/dynamicUpdateSession";
import { WorkspaceUpdatePanelFactory } from "@/webviews/workspaceUpdate/workspaceUpdatePanelFactory";

import { workspace } from "@repo/mocks";
import { WorkspaceUpdateApi, type WorkspaceUpdateState } from "@repo/shared";

import {
	createMockLogger,
	createMockWebviewPanel,
	setActiveColorTheme,
} from "../../../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";

vi.mock("@/api/dynamicUpdateSession");

function setup() {
	const built = createMockWebviewPanel(
		"coder.workspaceUpdate",
		"Update workspace",
		vscode.ViewColumn.One,
		{},
	);
	vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(built.panel);
	const state: WorkspaceUpdateState = {
		workspaceName: "test",
		templateVersionId: "version",
		revision: 1,
		status: "ready",
		parameters: [],
		inputs: {},
		locked: [],
		diagnostics: [],
		canSubmit: true,
	};
	const session = Object.assign(
		Object.create(DynamicUpdateSession.prototype) as DynamicUpdateSession,
		{
			state,
			initialize: vi.fn().mockResolvedValue(undefined),
			change: vi.fn(),
			retry: vi.fn().mockResolvedValue(undefined),
			submit: vi.fn().mockResolvedValue(true),
			dispose: vi.fn(),
		},
	);
	vi.mocked(DynamicUpdateSession).mockImplementation(function () {
		return session;
	});
	const factory = new WorkspaceUpdatePanelFactory(
		vscode.Uri.file("/ext"),
		createMockLogger(),
	);
	const client = {} as CoderApi;
	const ws = workspace();
	const result = factory.show(client, ws);
	return { ...built, session, factory, client, ws, result };
}

describe("WorkspaceUpdatePanelFactory", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("resends its in-memory state when the webview is ready", () => {
		const { hooks, session, panel } = setup();
		hooks.sendFromWebview({ method: WorkspaceUpdateApi.ready.method });
		expect(hooks.postedMessages).toContainEqual({
			type: WorkspaceUpdateApi.stateChanged.method,
			data: session.state,
		});
		expect(panel.webview.html).toContain("workspace-update/index.js");
		panel.dispose();
	});

	it("reveals the same workspace form rather than starting another session", () => {
		const { factory, client, ws, panel, result } = setup();
		expect(factory.show(client, ws)).toBe(result);
		expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
		panel.dispose();
	});

	it("cancels without submitting when the editor is closed", async () => {
		const { panel, session, result } = setup();
		panel.dispose();
		expect(await result).toBe(false);
		expect(session.submit).not.toHaveBeenCalled();
		expect(session.dispose).toHaveBeenCalledOnce();
	});

	it("routes edits and submits the acknowledged revision", async () => {
		const { hooks, session, result } = setup();
		hooks.sendFromWebview({
			method: WorkspaceUpdateApi.change.method,
			params: { name: "region", value: "west" },
		});
		expect(session.change).toHaveBeenCalledWith("region", "west");
		hooks.sendFromWebview({
			method: WorkspaceUpdateApi.submit.method,
			params: { revision: 1 },
		});
		expect(await result).toBe(true);
		expect(session.submit).toHaveBeenCalledWith(1);
	});

	it("keeps a failed update open for the user to inspect", async () => {
		const { hooks, panel, session } = setup();
		session.submit.mockResolvedValue(false);
		hooks.sendFromWebview({
			method: WorkspaceUpdateApi.submit.method,
			params: { revision: 1 },
		});
		await vi.waitFor(() => expect(session.submit).toHaveBeenCalled());
		expect(session.dispose).not.toHaveBeenCalled();
		panel.dispose();
	});
});

describe("update editor lifecycle", () => {
	it("resends state on visibility and theme changes", () => {
		const { hooks, panel } = setup();
		hooks.setVisible(false);
		const count = hooks.postedMessages.length;
		setActiveColorTheme(vscode.ColorThemeKind.Dark);
		expect(hooks.postedMessages).toHaveLength(count);
		hooks.setVisible(true);
		expect(hooks.postedMessages).toHaveLength(count + 1);
		setActiveColorTheme(vscode.ColorThemeKind.Light);
		expect(hooks.postedMessages).toHaveLength(count + 2);
		panel.dispose();
	});

	it("ignores malformed messages rather than logging parameter data", () => {
		const { hooks, panel, session } = setup();
		hooks.sendFromWebview({ secret: "do not log" });
		hooks.sendFromWebview({
			method: WorkspaceUpdateApi.change.method,
			params: null,
		});
		hooks.sendFromWebview({
			method: WorkspaceUpdateApi.submit.method,
			params: { revision: "1" },
		});
		expect(session.change).not.toHaveBeenCalled();
		expect(session.submit).not.toHaveBeenCalled();
		panel.dispose();
	});

	it("settles a form whose renderer never loads", async () => {
		vi.useFakeTimers();
		try {
			const { result, session } = setup();
			await vi.advanceTimersByTimeAsync(30_000);
			expect(await result).toBe(false);
			expect(session.dispose).toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
