/**
 * Webview test setup for jsdom environment.
 * Handles compatibility issues with Lit elements (vscode-elements).
 */
import { vi } from "vitest";

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
