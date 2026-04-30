import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { main } from "../../../packages/chat/src/index";
import { qs } from "../helpers";

const postToExtension = vi.fn();
const postToIframe = vi.fn();

const EMBED_URL = "https://coder.example.com/agents/abc/embed?theme=dark";
const ALLOWED_ORIGIN = "https://coder.example.com";

let iframe: HTMLIFrameElement;

beforeAll(() => {
	vi.stubGlobal(
		"acquireVsCodeApi",
		vi.fn(() => ({
			postMessage: postToExtension,
			getState: vi.fn(),
			setState: vi.fn(),
		})),
	);
	document.body.innerHTML = `
		<div id="status">Loading chat…</div>
		<iframe id="chat-frame" src="${EMBED_URL}" style="display:none;"></iframe>
	`;
	iframe = qs<HTMLIFrameElement>(document, "#chat-frame");
	// Spy on jsdom's real contentWindow.postMessage to avoid fabricating a Window.
	vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(
		postToIframe,
	);
	main();
});

afterAll(() => {
	vi.unstubAllGlobals();
});

beforeEach(() => {
	postToExtension.mockClear();
	postToIframe.mockClear();
});

function fireMessage(data: unknown, fromIframe = false): void {
	window.dispatchEvent(
		new MessageEvent("message", {
			data,
			source: fromIframe ? iframe.contentWindow : null,
		}),
	);
}

describe("chat shim", () => {
	it("forwards iframe coder:vscode-ready as ChatApi.vscodeReady", () => {
		fireMessage({ type: "coder:vscode-ready" }, true);
		expect(postToExtension).toHaveBeenCalledWith({
			method: "coder:vscode-ready",
		});
	});

	it("forwards iframe coder:chat-ready as ChatApi.chatReady", () => {
		fireMessage({ type: "coder:chat-ready" }, true);
		expect(postToExtension).toHaveBeenCalledWith({
			method: "coder:chat-ready",
		});
	});

	it("ignores iframe coder:navigate without a url payload", () => {
		fireMessage({ type: "coder:navigate", payload: {} }, true);
		expect(postToExtension).not.toHaveBeenCalled();
	});

	it("forwards iframe coder:navigate with a url payload", () => {
		fireMessage(
			{ type: "coder:navigate", payload: { url: "/templates" } },
			true,
		);
		expect(postToExtension).toHaveBeenCalledWith({
			method: "coder:navigate",
			params: { url: "/templates" },
		});
	});

	it("forwards extension setTheme into the iframe", () => {
		fireMessage({ type: "coder:set-theme", data: { theme: "light" } });
		expect(postToIframe).toHaveBeenCalledWith(
			{ type: "coder:set-theme", payload: { theme: "light" } },
			ALLOWED_ORIGIN,
		);
	});

	it("does not dispatch notification handlers for messages from the iframe", () => {
		// Source-isolation: a notification-typed iframe message must not reach
		// the typed handler (would destructure undefined and throw).
		expect(() =>
			fireMessage({ type: "coder:set-theme", payload: {} }, true),
		).not.toThrow();
		expect(postToIframe).not.toHaveBeenCalled();
	});

	it("renders a Retry button on auth-error and re-sends vscodeReady", () => {
		fireMessage({ type: "coder:auth-error", data: { error: "no token" } });
		const btn = qs<HTMLButtonElement>(document, "#retry-btn");
		btn.click();
		expect(postToExtension).toHaveBeenCalledWith({
			method: "coder:vscode-ready",
		});
	});
});
