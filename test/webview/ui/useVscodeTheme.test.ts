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

afterEach(() => {
	setThemeKind(undefined);
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
});
