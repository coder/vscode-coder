import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
	BASIC_NODES,
	activeGuides,
	activeRow,
	clickRow,
	clickTwistie,
	press,
	renderStatefulTree,
	renderTree,
	row,
	selectedRows,
	tree,
} from "./treeTestHelpers";

import type { TreeNode } from "@repo/ui";

const MULTI_NODES: readonly TreeNode[] = ["One", "Two", "Three", "Four"].map(
	(label) => ({ id: label.toLowerCase(), label }),
);
const multiTree = (selectedItemIds: readonly string[] = ["one"]) =>
	renderStatefulTree({
		"aria-label": "Multi",
		multiSelect: true,
		nodes: MULTI_NODES,
		selectedItemIds,
	});

describe("Tree multi-select", () => {
	it("toggles, replaces, and keeps the active row on the last one touched", () => {
		const { emitted } = multiTree();
		expect(tree()).toHaveAttribute("aria-multiselectable", "true");
		expect(selectedRows()).toEqual(["One"]);
		clickRow("Three", { ctrlKey: true });
		expect(selectedRows()).toEqual(["One", "Three"]);
		clickRow("One", { metaKey: true });
		expect(selectedRows()).toEqual(["Three"]);
		clickRow("Four");
		expect(emitted.selectedItemIds.at(-1)).toEqual(["four"]);
		expect(selectedRows()).toEqual(["Four"]);
		clickRow("Two", { ctrlKey: true });
		expect(activeRow()).toBe("Two");
	});

	it("extends and shrinks anchored ranges with clicks and arrows", () => {
		multiTree();
		clickRow("Two");
		clickRow("Four", { shiftKey: true });
		expect(selectedRows()).toEqual(["Two", "Three", "Four"]);
		clickRow("Three", { shiftKey: true });
		expect(selectedRows()).toEqual(["Two", "Three"]);
		press("ArrowDown", { shiftKey: true });
		expect(activeRow()).toBe("Four");
		expect(selectedRows()).toEqual(["Two", "Three", "Four"]);
		press("ArrowUp", { shiftKey: true });
		expect(selectedRows()).toEqual(["Two", "Three"]);
	});

	it("starts a range from the controlled selection", () => {
		multiTree();
		clickRow("Three", { shiftKey: true });
		expect(selectedRows()).toEqual(["One", "Two", "Three"]);
	});

	it("keeps the anchor when the controlled selection only reorders", () => {
		const onSelectedItemsChange = vi.fn();
		const view = renderTree({
			"aria-label": "Ordered",
			multiSelect: true,
			nodes: MULTI_NODES,
			selectedItemIds: ["one", "three"],
			onSelectedItemsChange,
		});
		view.update({ selectedItemIds: ["three", "one"] });
		clickRow("Four", { shiftKey: true });
		expect(onSelectedItemsChange).toHaveBeenLastCalledWith([
			"one",
			"two",
			"three",
			"four",
		]);
	});

	it("leaves Shift+Home and Shift+End as plain navigation", () => {
		multiTree();
		clickRow("Two");
		press("End", { shiftKey: true });
		expect(activeRow()).toBe("Four");
		expect(selectedRows()).toEqual(["Two"]);
		press("Home", { shiftKey: true });
		expect(activeRow()).toBe("One");
		expect(selectedRows()).toEqual(["Two"]);
	});

	it("uses the configured modifier for keyboard toggles", () => {
		const onSelectedItemsChange = vi.fn();
		renderTree({
			"aria-label": "Alt selection",
			multiSelect: true,
			multiSelectModifier: "alt",
			nodes: MULTI_NODES.slice(0, 2),
			selectedItemIds: ["one"],
			onSelectedItemsChange,
		});
		// Ctrl is not the modifier here, so Enter replaces the selection.
		press("Enter", { from: "Two", ctrlKey: true, shiftKey: true });
		expect(onSelectedItemsChange).toHaveBeenLastCalledWith(["two"]);
		press("Enter", { from: "Two", altKey: true, shiftKey: true });
		expect(onSelectedItemsChange).toHaveBeenLastCalledWith(["one", "two"]);
	});

	it("gives a selection modifier precedence over expansion", () => {
		const { emitted } = renderStatefulTree({
			"aria-label": "Modifier",
			multiSelect: true,
			selectedItemIds: [],
			nodes: BASIC_NODES,
			expandedIds: ["parent"],
		});
		clickRow("Parent", { ctrlKey: true });
		clickRow("Parent", { shiftKey: true });
		clickTwistie("Parent", { ctrlKey: true });
		expect(emitted.expandedIds).toEqual([]);
	});

	it("scopes Ctrl+A to the sibling group before widening to the parent", () => {
		const scoped = renderStatefulTree({
			"aria-label": "Scoped",
			multiSelect: true,
			selectedItemIds: [],
			expandedIds: ["parent"],
			nodes: [
				{
					id: "parent",
					label: "Parent",
					children: [
						{ id: "one", label: "One" },
						{ id: "three", label: "Three" },
					],
				},
				{ id: "outside", label: "Outside" },
			],
		});
		act(() => row("One").focus());
		press("a", { from: "One", ctrlKey: true });
		expect(selectedRows()).toEqual(["One", "Three"]);
		press("a", { from: "One", ctrlKey: true });
		expect(selectedRows()).toEqual(["Parent", "One", "Three"]);
		act(() => row("Parent").focus());
		press("a", { from: "Parent", ctrlKey: true });
		expect(selectedRows()).toEqual(["Parent", "One", "Three", "Outside"]);
		scoped.unmount();
		// Ctrl+Shift+A is not select-all, so the host keeps it.
		multiTree();
		expect(press("A", { from: "One", ctrlKey: true, shiftKey: true })).toBe(
			true,
		);
		expect(selectedRows()).toEqual(["One"]);
	});

	it("clears a multi-selection and its focus mark with Escape", () => {
		multiTree(["one", "two"]);
		act(() => row("One").focus());
		expect(press("Escape")).toBe(false);
		expect(selectedRows()).toEqual([]);
		expect(row("One")).toHaveClass("ui-tree-item--focused");
		// The focus mark outlives the first Escape only past one selected row.
		expect(press("Escape")).toBe(false);
		expect(row("One")).not.toHaveClass("ui-tree-item--focused");
		expect(press("Escape")).toBe(true);
	});

	it("lights a guide for every selected row", () => {
		renderTree({
			"aria-label": "Guides",
			multiSelect: true,
			selectedItemIds: ["a", "b"],
			expandedIds: ["parent"],
			nodes: [
				{
					id: "parent",
					label: "Parent",
					children: [
						{ id: "a", label: "A" },
						{ id: "b", label: "B" },
					],
				},
			],
		});
		expect(activeGuides("A")).toEqual([true]);
		expect(activeGuides("B")).toEqual([true]);
	});

	it("ignores selection modifiers without multiSelect", () => {
		const { emitted } = renderStatefulTree({
			"aria-label": "Single",
			selectedItemId: "one",
			nodes: MULTI_NODES.slice(0, 2),
		});
		expect(screen.getByRole("tree")).not.toHaveAttribute(
			"aria-multiselectable",
		);
		fireEvent.click(row("Two"), { ctrlKey: true });
		expect(emitted.selectedItemId.at(-1)).toBe("two");
		expect(selectedRows()).toEqual(["Two"]);
	});
});
