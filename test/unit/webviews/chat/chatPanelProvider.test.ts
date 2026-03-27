import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { ChatPanelProvider } from "@/webviews/chat/chatPanelProvider";

import { createMockLogger, MockCoderApi } from "../../../mocks/testHelpers";

const windowMock = vscode.window as typeof vscode.window & {
	__setActiveColorThemeKind: (kind: number) => void;
};

interface Harness {
	provider: ChatPanelProvider;
	postMessage: ReturnType<typeof vi.fn>;
	sendFromWebview: (msg: unknown) => void;
	html: () => string;
}

function createHarness(): Harness {
	const client = new MockCoderApi();
	client.setCredentials("https://coder.example.com", "test-token");

	const provider = new ChatPanelProvider(client, createMockLogger());

	let handler: ((msg: unknown) => void) | null = null;

	const webview: vscode.WebviewView = {
		viewType: ChatPanelProvider.viewType,
		webview: {
			options: { enableScripts: false },
			html: "",
			cspSource: "",
			postMessage: vi.fn().mockResolvedValue(true),
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

	const postMessage = webview.webview.postMessage as ReturnType<typeof vi.fn>;

	return {
		provider,
		postMessage,
		sendFromWebview: (msg: unknown) => handler?.(msg),
		html: () => webview.webview.html,
	};
}

function findPostedMessage(
	postMessage: ReturnType<typeof vi.fn>,
	type: string,
): unknown {
	return postMessage.mock.calls
		.map((c: unknown[]) => c[0])
		.find(
			(m: unknown) =>
				typeof m === "object" &&
				m !== null &&
				(m as { type?: string }).type === type,
		);
}

describe("ChatPanelProvider", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		windowMock.__setActiveColorThemeKind(vscode.ColorThemeKind.Dark);
	});

	describe("theme sync", () => {
		it.each([
			[vscode.ColorThemeKind.Dark, "dark"],
			[vscode.ColorThemeKind.Light, "light"],
			[vscode.ColorThemeKind.HighContrast, "dark"],
			[vscode.ColorThemeKind.HighContrastLight, "light"],
		])("maps ColorThemeKind %i to %s on chat-ready", (kind, expected) => {
			windowMock.__setActiveColorThemeKind(kind);
			const { sendFromWebview, postMessage } = createHarness();

			sendFromWebview({ type: "coder:chat-ready" });

			expect(findPostedMessage(postMessage, "coder:set-theme")).toEqual({
				type: "coder:set-theme",
				theme: expected,
			});
		});

		it("sends theme when VS Code theme changes", () => {
			const { postMessage } = createHarness();
			postMessage.mockClear();

			windowMock.__setActiveColorThemeKind(vscode.ColorThemeKind.Light);

			expect(postMessage).toHaveBeenCalledWith({
				type: "coder:set-theme",
				theme: "light",
			});
		});
	});

	describe("auth flow", () => {
		it("sends auth token on coder:vscode-ready", () => {
			const { sendFromWebview, postMessage } = createHarness();

			sendFromWebview({ type: "coder:vscode-ready" });

			expect(
				findPostedMessage(postMessage, "coder:auth-bootstrap-token"),
			).toEqual({
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

		it("blocks cross-origin navigate URLs", () => {
			const { sendFromWebview } = createHarness();

			sendFromWebview({
				type: "coder:navigate",
				payload: { url: "https://evil.com/steal" },
			});

			expect(vscode.env.openExternal).not.toHaveBeenCalled();
		});
	});

	describe("openChat", () => {
		it("renders embed iframe for the given chat ID", () => {
			const { provider, html } = createHarness();

			provider.openChat("test-agent-123");

			expect(html()).toContain(
				"https://coder.example.com/agents/test-agent-123/embed",
			);
		});

		it("focuses the chat panel", () => {
			const { provider } = createHarness();

			provider.openChat("test-agent-123");

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"coder.chatPanel.focus",
			);
		});

		it("shows placeholder when no chat ID is set", () => {
			const { html } = createHarness();

			expect(html()).toContain("No active chat session");
		});
	});

	describe("message filtering", () => {
		it("ignores non-object messages", () => {
			const { sendFromWebview, postMessage } = createHarness();

			sendFromWebview(null);
			sendFromWebview("string");
			sendFromWebview(42);

			expect(findPostedMessage(postMessage, "coder:set-theme")).toBeUndefined();
		});
	});
});
