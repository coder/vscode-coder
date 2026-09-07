import { fireEvent, render } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { ReactElement } from "react";

/** Pass-through className and style asserted by `expectRootStyling`. */
export const rootStyling = {
	className: "custom-root",
	style: { width: "200px" },
} as const;

/**
 * Renders `ui`, which must spread `rootStyling`, and asserts that `getRoot`
 * finds a root element carrying that className and style.
 */
export function expectRootStyling(
	ui: ReactElement,
	getRoot: () => Element | null,
): void {
	render(ui);
	const root = getRoot();
	expect(root).toHaveClass(rootStyling.className);
	expect(root).toHaveStyle(rootStyling.style);
}

/**
 * Asserts a text control reports edits through `onChange` without applying
 * them itself, and shows whatever value the consumer passes back.
 */
export function expectControlledText({
	renderControl,
	getControl,
	typed,
}: {
	renderControl: (
		value: string,
		onChange: (value: string) => void,
	) => ReactElement;
	getControl: () => HTMLElement;
	typed: string;
}): void {
	const onChange = vi.fn();
	const { rerender } = render(renderControl("", onChange));

	fireEvent.change(getControl(), { target: { value: typed } });
	expect(onChange).toHaveBeenCalledWith(typed);
	expect(getControl()).toHaveValue("");

	rerender(renderControl(typed, onChange));
	expect(getControl()).toHaveValue(typed);
}
