import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tree, TooltipProvider, type TreeNode, type TreeProps } from "@repo/ui";

import {
	BASIC_NODES,
	activeRow,
	clickRow,
	expandedRows,
	press,
	renderStatefulTree,
	renderTree,
	row,
	rowNames,
	selectedRows,
	tree,
} from "./treeTestHelpers";

/** Two branches and a leaf whose rich label holds a live control. */
const NAV_NODES: readonly TreeNode[] = [
	{
		id: "alpha",
		label: "Alpha",
		children: [
			{ id: "apricot", label: "Apricot" },
			{ id: "amber", label: "Amber" },
		],
	},
	{ id: "beta", label: "Beta", children: [{ id: "blue", label: "Blue" }] },
	{
		id: "bravo",
		label: (
			<>
				<span>Bravo</span>
				<button type="button">Action</button>
			</>
		),
		textValue: "Bravo",
	},
];

const navTree = (props: Partial<TreeProps> = {}) =>
	renderStatefulTree({
		"aria-label": "Navigation",
		nodes: NAV_NODES,
		expandedIds: ["alpha"],
		...props,
	});

describe("Tree keyboard navigation", () => {
	it("moves the active row with arrows, Home, and End", () => {
		navTree();
		for (const [key, active] of [
			["ArrowDown", "Apricot"],
			["ArrowDown", "Amber"],
			["End", "Bravo"],
			["Home", "Alpha"],
			["ArrowUp", "Alpha"],
		] as const) {
			press(key);
			expect(activeRow()).toBe(active);
		}
	});

	it("expands, enters, leaves, and collapses a branch", () => {
		navTree();
		press("ArrowRight", { from: "Beta" });
		expect(rowNames()).toContain("Blue");
		press("ArrowRight", { from: "Beta" });
		expect(activeRow()).toBe("Blue");
		press("ArrowLeft");
		expect(activeRow()).toBe("Beta");
		press("ArrowLeft");
		expect(rowNames()).not.toContain("Blue");
	});

	it("selects with Enter and toggles with Space", () => {
		navTree({ expandedIds: [] });
		press("Enter", { from: "Beta" });
		expect(selectedRows()).toEqual(["Beta"]);
		expect(expandedRows()).toEqual(["Beta"]);
		press(" ", { from: "Alpha" });
		expect(expandedRows()).toEqual(["Alpha", "Beta"]);
		expect(selectedRows()).toEqual(["Beta"]);
		// A leaf has nothing to toggle, so Space selects it.
		press(" ", { from: "Bravo" });
		expect(selectedRows()).toEqual(["Bravo"]);
	});

	it("only selects on Enter under doubleClick", () => {
		navTree({ expandedIds: [], expandMode: "doubleClick" });
		press("Enter", { from: "Beta" });
		expect(selectedRows()).toEqual(["Beta"]);
		expect(expandedRows()).toEqual([]);
	});

	it("clears selection, then the focus mark, before yielding Escape", () => {
		renderStatefulTree({
			"aria-label": "Escape",
			nodes: BASIC_NODES,
			expandedIds: ["parent"],
			selectedItemId: "child",
		});
		clickRow("Child");
		expect(press("Escape")).toBe(false);
		expect(selectedRows()).toEqual([]);
		expect(row("Child")).not.toHaveClass("ui-tree-item--focused");
		// Nothing left to clear, so the host gets the key.
		expect(press("Escape")).toBe(true);
	});

	it("lets the host claim keys first", () => {
		const captured: string[] = [];
		navTree({
			onKeyDown: (event) => {
				if (event.ctrlKey && event.key === "c") {
					captured.push(event.key);
					event.preventDefault();
				}
			},
		});
		clickRow("Alpha");
		fireEvent.keyDown(tree(), { key: "c", ctrlKey: true });
		expect(captured).toEqual(["c"]);
		// The tree never saw the key: nothing moved, nothing changed.
		expect(activeRow()).toBe("Alpha");
		expect(selectedRows()).toEqual(["Alpha"]);
	});

	it("leaves a control's own keys alone and takes navigation back", () => {
		navTree();
		const action = screen.getByRole("button", { name: "Action" });
		fireEvent.keyDown(action, { key: "Enter" });
		expect(selectedRows()).toEqual([]);
		fireEvent.keyDown(action, { key: "ArrowRight" });
		expect(document.activeElement).toBe(row("Bravo"));
	});

	it("navigates the current order after the data reorders", () => {
		const nodes = ["One", "Two"].map((label) => ({ id: label, label }));
		const view = renderTree({ "aria-label": "Reorder", nodes });
		press("ArrowDown");
		expect(activeRow()).toBe("Two");
		view.update({ nodes: [...nodes].reverse() });
		press("ArrowDown");
		expect(activeRow()).toBe("One");
	});
	it("moves by viewport pages, clamped at either end", () => {
		render(
			<div data-testid="scroller" style={{ overflowY: "auto" }}>
				<Tree
					aria-label="Paged"
					nodes={Array.from({ length: 12 }, (_, index) => ({
						id: `row-${index}`,
						label: `Row ${index}`,
					}))}
				/>
			</div>,
		);
		// jsdom lays nothing out, so a page is the scroller's height in rows.
		Object.defineProperty(screen.getByTestId("scroller"), "clientHeight", {
			value: 5 * 22,
		});
		for (const [key, active] of [
			["PageDown", "Row 5"],
			["PageDown", "Row 10"],
			["PageDown", "Row 11"],
			["PageUp", "Row 6"],
		] as const) {
			press(key);
			expect(activeRow()).toBe(active);
		}
	});

	it("opens the focused row's hover on the show-hover chord", async () => {
		render(
			<TooltipProvider delayDuration={0}>
				<Tree
					aria-label="Chord"
					nodes={[
						{ id: "alpha", label: "Alpha" },
						{ id: "beta", label: "Beta" },
					]}
				/>
			</TooltipProvider>,
		);
		act(() => tree().focus());
		press("k", { ctrlKey: true });
		expect(screen.queryByRole("tooltip")).toBeNull();
		press("i", { ctrlKey: true });
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Alpha");
		// Any other key puts it away again.
		press("ArrowDown");
		await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
	});

	describe("type-ahead", () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it("matches the labels the rows currently carry", () => {
			const view = renderTree({
				"aria-label": "Names",
				nodes: [
					{ id: "alpha", label: "Alpha" },
					{ id: "cedar", label: "Amber" },
				],
			});
			view.update({
				nodes: [
					{ id: "alpha", label: "Alpha" },
					{ id: "cedar", label: "Cedar" },
				],
			});
			press("c");
			expect(activeRow()).toBe("Cedar");
		});

		it("walks the matches when the same key repeats", () => {
			navTree();
			for (const active of ["Beta", "Bravo", "Beta"]) {
				press("b");
				expect(activeRow()).toBe(active);
			}
		});

		it("buffers keys into one query until it expires", () => {
			navTree();
			press("a");
			expect(activeRow()).toBe("Apricot");
			press("m");
			expect(activeRow()).toBe("Amber");
			void act(() => vi.advanceTimersByTime(800));
			press("a");
			expect(activeRow()).toBe("Alpha");
		});

		it("keeps a longer query on the row it already matched", () => {
			renderTree({
				"aria-label": "Prefixes",
				nodes: [
					{ id: "amber", label: "Amber" },
					{ id: "amethyst", label: "Amethyst" },
				],
			});
			press("a");
			expect(activeRow()).toBe("Amethyst");
			press("m");
			expect(activeRow()).toBe("Amethyst");
		});
	});
});
