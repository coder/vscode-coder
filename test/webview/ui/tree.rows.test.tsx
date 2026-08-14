import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
	BASIC_NODES,
	clickRow,
	clickTwistie,
	press,
	renderStatefulTree,
	renderTree,
	row,
	rowNames,
	selectedRows,
	tree,
} from "./treeTestHelpers";

import type { TreeNode } from "@repo/ui";

describe("Tree rows", () => {
	it("renders icons, rich labels, class names, and an action slot", () => {
		renderTree({
			"aria-label": "Rows",
			selectedItemId: "selected",
			nodes: [
				{ id: "plain", label: "Plain item", icon: "file" },
				{ id: "rich", label: <em>Rich item</em>, textValue: "Rich item" },
				{
					id: "selected",
					label: "Selected",
					className: "custom-item",
					action: <button type="button">Selected action</button>,
				},
			],
		});
		expect(
			row("Plain item").querySelector(".ui-tree-item__content > .ui-icon"),
		).toHaveClass("codicon-file");
		expect(row("Rich item")).toContainHTML("<em>Rich item</em>");
		expect(row("Selected")).toHaveClass("ui-tree-item", "custom-item");
		expect(selectedRows()).toEqual(["Selected"]);
		expect(
			screen.getByRole("button", { name: "Selected action" }).parentElement,
		).toHaveClass("ui-tree-item__action");
	});

	it("treats an empty children array as a branch that has not loaded", () => {
		const { emitted } = renderStatefulTree({
			"aria-label": "Lazy",
			nodes: [{ id: "lazy", label: "Lazy", children: [] }],
			expandedIds: [],
		});
		expect(row("Lazy")).toHaveAttribute("aria-expanded", "false");
		expect(
			row("Lazy").querySelector(".ui-tree-item__chevron > .ui-icon"),
		).toHaveClass("codicon-chevron-right");
		press("ArrowRight", { from: "Lazy" });
		expect(row("Lazy")).toHaveAttribute("aria-expanded", "true");
		expect(emitted.expandedIds.at(-1)).toEqual(["lazy"]);
	});

	it("expands on a single click, and never from the twistie's selection", () => {
		renderStatefulTree({
			"aria-label": "Single click",
			nodes: BASIC_NODES,
			expandedIds: ["parent"],
		});
		clickRow("Parent");
		expect(selectedRows()).toEqual(["Parent"]);
		expect(rowNames()).toEqual(["Parent", "Last"]);
		clickTwistie("Parent");
		expect(rowNames()).toEqual(["Parent", "Child", "Sibling", "Last"]);
		expect(selectedRows()).toEqual(["Parent"]);
	});

	it("waits for the second click under doubleClick", () => {
		renderStatefulTree({
			"aria-label": "Double click",
			nodes: BASIC_NODES,
			expandedIds: ["parent"],
			expandMode: "doubleClick",
		});
		clickRow("Parent", { detail: 1 });
		expect(selectedRows()).toEqual(["Parent"]);
		expect(rowNames()).toContain("Child");
		clickRow("Parent", { detail: 2 });
		expect(rowNames()).not.toContain("Child");
	});

	it("expands every descendant branch on an Alt twistie click", () => {
		renderStatefulTree({
			"aria-label": "Recursive",
			nodes: [
				{
					id: "root",
					label: "Root",
					children: [
						{
							id: "one",
							label: "One",
							children: [{ id: "deep", label: "Deep" }],
						},
						{ id: "two", label: "Two", children: [] },
					],
				},
			],
			expandedIds: ["one"],
		});
		clickTwistie("Root", { altKey: true });
		expect(rowNames()).toEqual(["Root", "One", "Deep", "Two"]);
	});

	it("keeps a row action live and out of the row's way", async () => {
		const onAction = vi.fn();
		const { emitted } = renderStatefulTree({
			"aria-label": "Actions",
			nodes: [
				{
					...BASIC_NODES[0],
					action: (
						<button type="button" onClick={onAction}>
							Delete
						</button>
					),
				},
			],
			expandedIds: ["parent"],
		});
		const action = screen.getByRole("button", { name: "Delete" });
		// Live before the row is ever touched, like a native action bar.
		fireEvent.click(action);
		expect(onAction).toHaveBeenCalledOnce();
		expect(selectedRows()).toEqual([]);
		expect(emitted.expandedIds).toEqual([]);
		const user = userEvent.setup();
		await user.tab();
		expect(document.activeElement).toBe(tree());
		await user.tab();
		expect(document.activeElement).toBe(action);
	});

	it("leaves a click on anything focusable in a row to that element", () => {
		const nodes: readonly TreeNode[] = [
			{
				id: "row",
				textValue: "Row",
				label: (
					<>
						<span data-testid="text">Row</span>
						<a href="#anchor">Link</a>
						<input aria-label="Field" />
						<span role="button" tabIndex={0}>
							Widget
						</span>
					</>
				),
			},
		];
		renderStatefulTree({ "aria-label": "Nested", nodes });
		for (const name of ["link", "textbox", "button"] as const) {
			fireEvent.click(screen.getByRole(name));
		}
		expect(selectedRows()).toEqual([]);
		fireEvent.click(screen.getByTestId("text"));
		expect(selectedRows()).toEqual(["Row"]);
	});
});
