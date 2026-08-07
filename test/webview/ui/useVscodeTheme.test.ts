import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useVscodeTheme } from "@repo/ui";

/** Mirrors the body attributes VS Code sets on the webview; omit to clear. */
function setTheme(kind?: string, id?: string): void {
	const { body } = document;
	for (const [attribute, value] of [
		["data-vscode-theme-kind", kind],
		["data-vscode-theme-id", id],
	] as const) {
		if (value === undefined) {
			body.removeAttribute(attribute);
		} else {
			body.setAttribute(attribute, value);
		}
	}
}

afterEach(() => {
	// Unmount before clearing: the attribute change notifies the observer, and
	// a still-mounted hook would then update outside act().
	cleanup();
	setTheme();
});

describe("useVscodeTheme", () => {
	it.each([
		["vscode-light", "light"],
		["vscode-dark", "dark"],
		["vscode-high-contrast", "high-contrast"],
		["vscode-high-contrast-light", "high-contrast-light"],
	])("returns %s as %s", (attribute, expected) => {
		setTheme(attribute);

		const { result } = renderHook(() => useVscodeTheme());

		expect(result.current).toBe(expected);
	});

	it("defaults to dark when the attribute is missing", () => {
		const { result } = renderHook(() => useVscodeTheme());

		expect(result.current).toBe("dark");
	});

	it("updates when the theme changes", async () => {
		setTheme("vscode-dark");

		const { result } = renderHook(() => useVscodeTheme());
		expect(result.current).toBe("dark");

		// MutationObserver callbacks are microtasks; flush them inside act.
		await act(async () => {
			setTheme("vscode-light");
			await Promise.resolve();
		});
		expect(result.current).toBe("light");
	});

	it("re-renders when switching between two themes of the same kind", async () => {
		setTheme("vscode-dark", "vscode-dark-modern");
		let renders = 0;

		const { result } = renderHook(() => {
			renders += 1;
			return useVscodeTheme();
		});
		const rendersBefore = renders;

		await act(async () => {
			setTheme("vscode-dark", "vscode-dark-plus");
			await Promise.resolve();
		});
		expect(renders).toBeGreaterThan(rendersBefore);
		expect(result.current).toBe("dark");
	});
});
