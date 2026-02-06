/**
 * Webview test setup for jsdom environment.
 * Handles compatibility issues with Lit elements (vscode-elements).
 */
import { vi } from "vitest";

// vscode-elements expects a <link id="vscode-codicon-stylesheet"> to load icon
// fonts inside shadow DOM. In production, src/webviews/util.ts adds this element.
// In jsdom we add a stub to suppress the "codicons.css file must be included" warning.
if (typeof document !== "undefined") {
	const link = document.createElement("link");
	link.id = "vscode-codicon-stylesheet";
	link.rel = "stylesheet";
	document.head.appendChild(link);
}

// Lit elements use ElementInternals which is not fully supported in jsdom.
// Mock ElementInternals.setFormValue to prevent "setFormValue is not a function" errors.
// This needs to run before any Lit elements are imported.
if (typeof HTMLElement !== "undefined") {
	const originalAttachInternals = HTMLElement.prototype.attachInternals;
	if (originalAttachInternals) {
		vi.spyOn(HTMLElement.prototype, "attachInternals").mockImplementation(
			function (this: HTMLElement) {
				const internals = originalAttachInternals.call(this);
				// Add missing methods that jsdom doesn't support
				if (!internals.setFormValue) {
					internals.setFormValue = vi.fn();
				}
				return internals;
			},
		);
	}
}
