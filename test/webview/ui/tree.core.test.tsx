import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Tree, type TreeNode } from "@repo/ui";

import {
	BASIC_NODES,
	activeGuides,
	activeRow,
	clickRow,
	press,
	renderTree,
	row,
	rowNames,
	selectedRows,
	tree,
} from "./treeTestHelpers";

/** The ARIA a flat row declares for itself, there being no groups. */
const semantics = (name: string): Record<string, string | null> => {
	const item = row(name);
	return {
		level: item.getAttribute("aria-level"),
		posInSet: item.getAttribute("aria-posinset"),
		setSize: item.getAttribute("aria-setsize"),
		expanded: item.getAttribute("aria-expanded"),
		tabIndex: item.getAttribute("tabindex"),
	};
};

describe("Tree", () => {
	it("forwards container props and declares flat row semantics", () => {
		const ref = createRef<HTMLDivElement>();
		renderTree({
			"aria-label": "Explorer",
			variant: "explorer",
			className: "custom-tree",
			style: { width: "240px" },
			ref,
			nodes: BASIC_NODES,
			expandedIds: ["parent"],
		});
		const container = screen.getByRole("tree", { name: "Explorer" });
		expect(container).toHaveClass(
			"ui-tree",
			"ui-tree--explorer",
			"custom-tree",
		);
		expect(container).toHaveStyle({ width: "240px" });
		expect(container).toHaveAttribute("tabindex", "0");
		expect(ref.current).toBe(container);
		expect(rowNames()).toEqual(["Parent", "Child", "Sibling", "Last"]);
		expect(semantics("Parent")).toEqual({
			level: "1",
			posInSet: "1",
			setSize: "2",
			expanded: "true",
			tabIndex: "-1",
		});
		expect(semantics("Sibling")).toEqual({
			level: "2",
			posInSet: "2",
			setSize: "2",
			expanded: null,
			tabIndex: "-1",
		});
		expect(semantics("Last")).toEqual({
			level: "1",
			posInSet: "2",
			setSize: "2",
			expanded: null,
			tabIndex: "-1",
		});
		expect(screen.queryByRole("group")).toBeNull();
	});

	it("keeps DOM focus on the container while the active row moves", () => {
		renderTree({
			"aria-label": "Files",
			nodes: BASIC_NODES,
			expandedIds: ["parent"],
		});
		act(() => tree().focus());
		expect(activeRow()).toBe("Parent");
		press("ArrowDown");
		expect(activeRow()).toBe("Child");
		expect(document.activeElement).toBe(tree());
	});

	it("keeps focus through a collapse, a reveal, and a removal", () => {
		const withChild: readonly TreeNode[] = [
			{ id: "top", label: "Top" },
			{
				id: "parent",
				label: "Parent",
				children: [{ id: "child", label: "Child" }],
			},
		];
		const view = renderTree({
			"aria-label": "Reveal",
			nodes: withChild,
			expandedIds: ["parent"],
		});
		clickRow("Child");
		expect(activeRow()).toBe("Child");
		view.update({ expandedIds: [] });
		expect(activeRow()).toBeUndefined();
		view.update({ expandedIds: ["parent"] });
		expect(activeRow()).toBe("Child");
		view.update({
			nodes: [withChild[0], { id: "parent", label: "Parent", children: [] }],
		});
		expect(activeRow()).toBe("Parent");
	});

	it("draws indent guides for the selected row, and the focused one in focus", () => {
		const nodes: readonly TreeNode[] = ["Alpha", "Beta"].map((branch) => ({
			id: branch,
			label: branch,
			children: [{ id: `${branch} leaf`, label: `${branch} leaf` }],
		}));
		const view = renderTree({
			"aria-label": "Guides",
			nodes,
			expandedIds: ["Alpha", "Beta"],
		});
		expect(activeGuides("Alpha leaf")).toEqual([false]);
		clickRow("Beta leaf");
		expect(activeGuides("Beta leaf")).toEqual([true]);
		view.update({ selectedItemId: "Alpha leaf" });
		expect(activeGuides("Alpha leaf")).toEqual([true]);
		fireEvent.blur(row("Beta leaf"), { relatedTarget: document.body });
		expect(activeGuides("Beta leaf")).toEqual([false]);
		expect(activeGuides("Alpha leaf")).toEqual([true]);
	});

	it("activates only the guide of the branch a row belongs to", () => {
		renderTree({
			"aria-label": "Nested guides",
			nodes: [
				{
					id: "root",
					label: "Root",
					children: [
						{
							id: "branch",
							label: "Branch",
							children: [{ id: "leaf", label: "Leaf" }],
						},
					],
				},
			],
			expandedIds: ["root", "branch"],
		});
		clickRow("Branch");
		expect(activeGuides("Leaf")).toEqual([false, true]);
	});

	it("follows controlled selection and keeps the focus mark while blurred", () => {
		const view = renderTree({
			"aria-label": "Selection",
			nodes: BASIC_NODES,
			expandedIds: ["parent"],
			selectedItemId: "child",
		});
		expect(selectedRows()).toEqual(["Child"]);
		view.update({ selectedItemId: "last" });
		expect(selectedRows()).toEqual(["Last"]);
		act(() => row("Child").focus());
		expect(row("Child")).toHaveClass("ui-tree-item--focused");
		fireEvent.blur(row("Child"), { relatedTarget: document.body });
		expect(row("Child")).toHaveClass("ui-tree-item--focused");
		expect(tree()).not.toHaveClass("ui-tree--focused");
	});

	it("scopes the focused styling to the tree the user is in", () => {
		render(
			<>
				<Tree
					aria-label="First"
					selectedItemId="first"
					nodes={[{ id: "first", label: "First item" }]}
				/>
				<Tree
					aria-label="Second"
					selectedItemId="second"
					nodes={[{ id: "second", label: "Second item" }]}
				/>
			</>,
		);
		const first = screen.getByRole("tree", { name: "First" });
		const second = screen.getByRole("tree", { name: "Second" });
		fireEvent.focus(row("First item"));
		expect(first).toHaveClass("ui-tree--focused");
		expect(second).not.toHaveClass("ui-tree--focused");
		fireEvent.blur(row("First item"), { relatedTarget: row("Second item") });
		fireEvent.focus(row("Second item"));
		expect(first).not.toHaveClass("ui-tree--focused");
		expect(second).toHaveClass("ui-tree--focused");
	});
});
