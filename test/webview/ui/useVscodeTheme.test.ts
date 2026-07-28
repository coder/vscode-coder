import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useVscodeTheme } from "@repo/ui";

function setThemeKind(kind: string | undefined): void {
	if (kind === undefined) {
		document.body.removeAttribute("data-vscode-theme-kind");
	} else {
		document.body.setAttribute("data-vscode-theme-kind", kind);
	}
}

function setThemeId(id: string | undefined): void {
	if (id === undefined) {
		document.body.removeAttribute("data-vscode-theme-id");
	} else {
		document.body.setAttribute("data-vscode-theme-id", id);
	}
}

afterEach(() => {
	setThemeKind(undefined);
	setThemeId(undefined);
});

describe("useVscodeTheme", () => {
	it.each([
		["vscode-light", "light"],
		["vscode-dark", "dark"],
		["vscode-high-contrast", "high-contrast"],
		["vscode-high-contrast-light", "high-contrast-light"],
	])("returns %s as %s", (attribute, expected) => {
		setThemeKind(attribute);

		const { result } = renderHook(() => useVscodeTheme());

		expect(result.current).toBe(expected);
	});

	it("defaults to dark when the attribute is missing", () => {
		const { result } = renderHook(() => useVscodeTheme());

		expect(result.current).toBe("dark");
	});

	it("updates when the theme changes", async () => {
		setThemeKind("vscode-dark");

		const { result } = renderHook(() => useVscodeTheme());
		expect(result.current).toBe("dark");

		// MutationObserver callbacks are microtasks; flush them inside act.
		await act(async () => {
			setThemeKind("vscode-light");
			await Promise.resolve();
		});
		expect(result.current).toBe("light");
	});

	it("re-renders when switching between two themes of the same kind", async () => {
		setThemeKind("vscode-dark");
		setThemeId("vscode-dark-modern");
		let renders = 0;

		const { result } = renderHook(() => {
			renders += 1;
			return useVscodeTheme();
		});
		const rendersBefore = renders;

		// MutationObserver callbacks are microtasks; flush them inside act.
		await act(async () => {
			setThemeId("vscode-dark-plus");
			await Promise.resolve();
		});
		expect(renders).toBeGreaterThan(rendersBefore);
		expect(result.current).toBe("dark");
	});
});
