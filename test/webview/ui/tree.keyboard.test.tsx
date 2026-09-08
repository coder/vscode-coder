import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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

import type { TreeNode, TreeProps } from "@repo/ui";

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
		press("ArrowRight", "Beta");
		expect(rowNames()).toContain("Blue");
		press("ArrowRight", "Beta");
		expect(activeRow()).toBe("Blue");
		press("ArrowLeft");
		expect(activeRow()).toBe("Beta");
		press("ArrowLeft");
		expect(rowNames()).not.toContain("Blue");
	});

	it("selects with Enter and toggles with Space", () => {
		navTree({ expandedIds: [] });
		press("Enter", "Beta");
		expect(selectedRows()).toEqual(["Beta"]);
		expect(expandedRows()).toEqual(["Beta"]);
		press(" ", "Alpha");
		expect(expandedRows()).toEqual(["Alpha", "Beta"]);
		expect(selectedRows()).toEqual(["Beta"]);
		// A leaf has nothing to toggle, so Space selects it.
		press(" ", "Bravo");
		expect(selectedRows()).toEqual(["Bravo"]);
	});

	it("only selects on Enter under doubleClick", () => {
		navTree({ expandedIds: [], expandMode: "doubleClick" });
		press("Enter", "Beta");
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
});
