import { describe, expect, it } from "vitest";
import * as vscode from "vscode";

import { escapeHtml, getNonce, getWebviewHtml } from "@/webviews/html";

const webview: vscode.Webview = {
	options: { enableScripts: true, localResourceRoots: [] },
	html: "",
	cspSource: "mock-csp",
	onDidReceiveMessage: () => ({ dispose: () => undefined }),
	postMessage: () => Promise.resolve(true),
	asWebviewUri: (uri) => uri,
};

const extensionUri = vscode.Uri.file("/ext");

describe("escapeHtml", () => {
	it("escapes the five special characters", () => {
		expect(escapeHtml(`<a href="x" onclick='y'>&hi</a>`)).toBe(
			"&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;hi&lt;/a&gt;",
		);
	});

	it("returns plain text unchanged", () => {
		expect(escapeHtml("Speed Test: owner/workspace")).toBe(
			"Speed Test: owner/workspace",
		);
	});

	it("escapes & first so injected entities are themselves escaped", () => {
		expect(escapeHtml("&amp;")).toBe("&amp;amp;");
	});
});

describe("getNonce", () => {
	it("returns a fresh 24-char base64 string each call", () => {
		const a = getNonce();
		const b = getNonce();
		expect(a).toMatch(/^[A-Za-z0-9+/=]{24}$/);
		expect(a).not.toBe(b);
	});
});

describe("getWebviewHtml", () => {
	it("escapes the title to prevent HTML injection", () => {
		const html = getWebviewHtml(
			webview,
			extensionUri,
			"speedtest",
			"</title><script>alert(1)</script>",
		);
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain(
			"&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
		);
	});

	it("pins script-src to a per-document nonce shared by every script tag", () => {
		const html = getWebviewHtml(webview, extensionUri, "speedtest", "ok");
		const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
		expect(nonce).toMatch(/^[A-Za-z0-9+/=]{24}$/);
		expect(html).toContain(`<script nonce="${nonce}"`);
		expect(html).toContain(`<link id="vscode-codicon-stylesheet"`);
		expect(html).toContain(`nonce="${nonce}"`);
	});

	it("references the bundle entry under dist/webviews/<name>", () => {
		const html = getWebviewHtml(webview, extensionUri, "speedtest", "ok");
		expect(html).toContain("/dist/webviews/speedtest/index.js");
		expect(html).toContain("/dist/webviews/speedtest/index.css");
	});

	it("uses the webview's cspSource for style/font/img sources", () => {
		const html = getWebviewHtml(webview, extensionUri, "speedtest", "ok");
		expect(html).toContain(
			"style-src mock-csp 'unsafe-inline'; font-src mock-csp; img-src mock-csp data:;",
		);
	});
});
