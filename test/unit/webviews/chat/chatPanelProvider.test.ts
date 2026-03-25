import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { ChatPanelProvider } from "@/webviews/chat/chatPanelProvider";

import { createMockLogger, MockCoderApi } from "../../../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";

type WindowMock = typeof vscode.window & {
	activeColorTheme: { kind: number };
	__fireDidChangeActiveColorTheme: (e: unknown) => void;
};

function setMockTheme(kind: number): void {
	(vscode.window as WindowMock).activeColorTheme = { kind };
}

function findMessage(messages: unknown[], type: string): unknown {
	return messages.find(
		(m) =>
			typeof m === "object" &&
			m !== null &&
			(m as { type?: string }).type === type,
	);
}

interface Harness {
	provider: ChatPanelProvider;
	client: MockCoderApi;
	postMessage: ReturnType<typeof vi.fn>;
	sendFromWebview: (msg: unknown) => void;
	messages: () => unknown[];
}

function createHarness(): Harness {
	const client = new MockCoderApi();
	client.setCredentials("https://coder.example.com", "test-token");

	const provider = new ChatPanelProvider(
		client as unknown as CoderApi,
		createMockLogger(),
	);

	const posted: unknown[] = [];
	let handler: ((msg: unknown) => void) | null = null;

	const webview: vscode.WebviewView = {
		viewType: ChatPanelProvider.viewType,
		webview: {
			options: { enableScripts: false },
			html: "",
			cspSource: "",
			postMessage: vi.fn((msg: unknown) => {
				posted.push(msg);
				return Promise.resolve(true);
			}),
			onDidReceiveMessage: vi.fn((h) => {
				handler = h;
				return { dispose: vi.fn() };
			}),
			asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
		},
		title: undefined,
		description: undefined,
		badge: undefined,
		visible: true,
		show: vi.fn(),
		onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
		onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
	};

	provider.resolveWebviewView(
		webview,
		{} as vscode.WebviewViewResolveContext,
		{} as vscode.CancellationToken,
	);

	return {
		provider,
		client,
		postMessage: webview.webview.postMessage as ReturnType<typeof vi.fn>,
		sendFromWebview: (msg: unknown) => handler?.(msg),
		messages: () => [...posted],
	};
}

describe("ChatPanelProvider", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		setMockTheme(vscode.ColorThemeKind.Dark);
	});

	describe("theme sync", () => {
		it("sends dark theme on coder:chat-ready", () => {
			const { sendFromWebview, messages } = createHarness();

			sendFromWebview({ type: "coder:chat-ready" });

			expect(findMessage(messages(), "coder:set-theme")).toEqual({
				type: "coder:set-theme",
				theme: "dark",
			});
		});

		it("sends scroll-to-bottom on coder:chat-ready", () => {
			const { sendFromWebview, messages } = createHarness();

			sendFromWebview({ type: "coder:chat-ready" });

			expect(findMessage(messages(), "coder:scroll-to-bottom")).toEqual({
				type: "coder:scroll-to-bottom",
			});
		});

		it("sends light theme on coder:chat-ready", () => {
			setMockTheme(vscode.ColorThemeKind.Light);
			const { sendFromWebview, messages } = createHarness();

			sendFromWebview({ type: "coder:chat-ready" });

			expect(findMessage(messages(), "coder:set-theme")).toEqual({
				type: "coder:set-theme",
				theme: "light",
			});
		});

		it("detects HighContrastLight as light theme", () => {
			setMockTheme(vscode.ColorThemeKind.HighContrastLight);
			const { sendFromWebview, messages } = createHarness();

			sendFromWebview({ type: "coder:chat-ready" });

			expect(findMessage(messages(), "coder:set-theme")).toEqual({
				type: "coder:set-theme",
				theme: "light",
			});
		});

		it("detects HighContrast as dark theme", () => {
			setMockTheme(vscode.ColorThemeKind.HighContrast);
			const { sendFromWebview, messages } = createHarness();

			sendFromWebview({ type: "coder:chat-ready" });

			expect(findMessage(messages(), "coder:set-theme")).toEqual({
				type: "coder:set-theme",
				theme: "dark",
			});
		});

		it("sends theme when VS Code theme changes", () => {
			const { postMessage } = createHarness();
			postMessage.mockClear();

			setMockTheme(vscode.ColorThemeKind.Light);
			(vscode.window as WindowMock).__fireDidChangeActiveColorTheme({
				kind: vscode.ColorThemeKind.Light,
			});

			expect(postMessage).toHaveBeenCalledWith({
				type: "coder:set-theme",
				theme: "light",
			});
		});
	});

	describe("auth flow", () => {
		it("sends auth token on coder:vscode-ready", () => {
			const { sendFromWebview, messages } = createHarness();

			sendFromWebview({ type: "coder:vscode-ready" });

			expect(findMessage(messages(), "coder:auth-bootstrap-token")).toEqual({
				type: "coder:auth-bootstrap-token",
				token: "test-token",
			});
		});
	});

	describe("navigation", () => {
		it("opens external URL on coder:navigate", () => {
			const { sendFromWebview } = createHarness();

			sendFromWebview({
				type: "coder:navigate",
				payload: { url: "/templates" },
			});

			expect(vscode.env.openExternal).toHaveBeenCalledWith(
				vscode.Uri.parse("https://coder.example.com/templates"),
			);
		});

		it("ignores navigate without url payload", () => {
			const { sendFromWebview } = createHarness();

			sendFromWebview({ type: "coder:navigate" });

			expect(vscode.env.openExternal).not.toHaveBeenCalled();
		});
	});

	describe("iframe HTML", () => {
		it("generates HTML with iframe when chat ID is set", () => {
			const { provider } = createHarness();

			provider.openChat("test-agent-123");

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.chatPanel.focus",
			);
		});

		it("shows no-agent message when no chat ID is set", () => {
			const harness = createHarness();

			const webview = (
				harness.provider as unknown as { view: vscode.WebviewView }
			).view;
			expect(webview.webview.html).toContain("No active chat session");
		});
	});

	describe("message filtering", () => {
		it("ignores non-object messages", () => {
			const { sendFromWebview, messages } = createHarness();

			sendFromWebview(null);
			sendFromWebview("string");
			sendFromWebview(42);

			expect(findMessage(messages(), "coder:set-theme")).toBeUndefined();
		});
	});
});
