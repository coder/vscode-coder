import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { showResultPanel } from "@/webviews/resultPanel";

import {
	createMockLogger,
	createMockWebviewPanel,
	setActiveColorTheme,
	type WebviewPanelTestHooks,
} from "../../mocks/testHelpers";

const READY = "test/ready";
const VIEW_JSON = "test/viewJson";
const DATA = "test/data";
const payload = { value: 1, label: "ready", nested: { items: [1, 2, 3] } };

interface Harness {
	panel: vscode.WebviewPanel;
	hooks: WebviewPanelTestHooks;
}

function open(rawJson = '{"raw":true}'): Harness {
	let panel!: vscode.WebviewPanel;
	let hooks!: WebviewPanelTestHooks;

	vi.mocked(vscode.window.createWebviewPanel).mockImplementation((...args) => {
		const built = createMockWebviewPanel(...args);
		panel = built.panel;
		hooks = built.hooks;
		return panel;
	});

	showResultPanel({
		extensionUri: vscode.Uri.file("/ext"),
		logger: createMockLogger(),
		viewType: "coder.testPanel",
		webviewName: "test",
		title: "Test Panel",
		rawJson,
		jsonErrorLabel: "test",
		notify: (webview) => {
			void webview.postMessage({ type: DATA, data: payload });
		},
		buildHandlers: ({ sendData, openRawJson }) => ({
			commands: {
				[READY]: () => sendData(),
				[VIEW_JSON]: () => {
					void openRawJson();
				},
			},
			requests: {},
		}),
	});
	return { panel, hooks };
}

describe("showResultPanel", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("opens a titled webview and pushes the payload only after the webview signals ready", () => {
		const { panel, hooks } = open();

		expect(panel.viewType).toBe("coder.testPanel");
		expect(panel.title).toBe("Test Panel");
		expect(panel.webview.html).toContain("Test Panel");
		expect(hooks.postedMessages).toEqual([]);

		hooks.sendFromWebview({ method: READY });

		expect(hooks.postedMessages).toEqual([{ type: DATA, data: payload }]);
	});

	it("re-pushes the payload when the panel returns to visible", () => {
		const { hooks } = open();
		hooks.sendFromWebview({ method: READY });
		const before = hooks.postedMessages.length;

		hooks.setVisible(true);

		expect(hooks.postedMessages.length - before).toBe(1);
	});

	it("does not push while the panel is hidden", () => {
		const { hooks } = open();
		hooks.sendFromWebview({ method: READY });
		const before = hooks.postedMessages.length;

		hooks.setVisible(false);

		expect(hooks.postedMessages.length).toBe(before);
	});

	it("re-pushes the payload on theme change while visible", () => {
		const { hooks } = open();
		hooks.sendFromWebview({ method: READY });
		const before = hooks.postedMessages.length;

		setActiveColorTheme(vscode.ColorThemeKind.Light);

		expect(hooks.postedMessages.length - before).toBe(1);
	});

	it("opens the raw JSON beside the panel on the viewJson command", async () => {
		const doc = { uri: vscode.Uri.file("/tmp/doc") } as vscode.TextDocument;
		vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(doc);

		const { hooks } = open('{"ok":1}');
		hooks.sendFromWebview({ method: VIEW_JSON });

		await vi.waitFor(() =>
			expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
				doc,
				vscode.ViewColumn.Beside,
			),
		);
		expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({
			content: '{"ok":1}',
			language: "json",
		});
	});

	it("does not surface an error dialog for unknown command methods", async () => {
		const { hooks } = open();
		hooks.sendFromWebview({ method: "test/bogus" });
		// Dispatch is async; let the rejection settle before asserting.
		await Promise.resolve();
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
	});

	it("stops responding to visibility and theme events after disposal", () => {
		const { hooks } = open();
		hooks.fireDispose();
		const before = hooks.postedMessages.length;

		hooks.setVisible(true);
		setActiveColorTheme(vscode.ColorThemeKind.Light);

		expect(hooks.postedMessages.length).toBe(before);
	});
});
