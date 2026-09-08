import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tree, TooltipProvider } from "@repo/ui";

import { press, row, stubElementBoxes, tree } from "./treeTestHelpers";

const DELAY_MS = 500;
const label = (): Element =>
	row("Alpha").getElementsByClassName("ui-tree-item__content")[0];

const elapse = (): void => {
	act(() => {
		vi.advanceTimersByTime(DELAY_MS);
	});
};

function renderHoverTree() {
	return render(
		<Tree
			aria-label="Hover"
			nodes={[
				{
					id: "a",
					label: "Alpha",
					action: (
						<button
							type="button"
							onPointerDown={(event) => event.stopPropagation()}
						>
							Delete
						</button>
					),
				},
			]}
		/>,
		{
			wrapper: ({ children }) => (
				<TooltipProvider delayDuration={DELAY_MS}>{children}</TooltipProvider>
			),
		},
	);
}

describe("Tree hover", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		stubElementBoxes();
	});
	afterEach(() => vi.useRealTimers());

	describe.each(["pending", "shown"] as const)("%s hover", (state) => {
		it.each([
			["a tree press", () => fireEvent.pointerDown(tree())],
			[
				"an action press that stops propagation",
				() => fireEvent.pointerDown(screen.getByRole("button")),
			],
			["a key press", () => press("ArrowDown")],
			[
				"focus leaving the tree",
				() => fireEvent.focusOut(tree(), { relatedTarget: document.body }),
			],
		])("dismisses on %s without reopening", (_name, dismiss) => {
			renderHoverTree();
			act(() => tree().focus());
			fireEvent.pointerEnter(label());
			if (state === "shown") {
				elapse();
				expect(screen.getByRole("tooltip")).toHaveTextContent("Alpha");
			}
			dismiss();
			expect(screen.queryByRole("tooltip")).toBeNull();
			elapse();
			expect(screen.queryByRole("tooltip")).toBeNull();
		});
	});

	it.each([
		["pointer leave", () => fireEvent.pointerLeave(label())],
		["pointer press", () => fireEvent.pointerDown(tree())],
	])("permits a fresh hover after %s", (_name, dismiss) => {
		renderHoverTree();
		fireEvent.pointerEnter(label());
		dismiss();
		elapse();
		expect(screen.queryByRole("tooltip")).toBeNull();
		fireEvent.pointerEnter(label());
		expect(screen.queryByRole("tooltip")).toBeNull();
		elapse();
		expect(screen.getByRole("tooltip")).toHaveTextContent("Alpha");
	});

	it.each(["hidden", "removed"])(
		"does not open for a target %s during the delay",
		(state) => {
			const view = renderHoverTree();
			const target = label();
			fireEvent.pointerEnter(target);
			if (state === "hidden") {
				vi.spyOn(target, "getBoundingClientRect").mockReturnValue(
					new DOMRect(),
				);
			} else {
				view.rerender(<Tree aria-label="Hover" nodes={[]} />);
			}
			elapse();
			expect(screen.queryByRole("tooltip")).toBeNull();
		},
	);
});
