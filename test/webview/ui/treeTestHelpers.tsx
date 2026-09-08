import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { Tree, type TreeNode, type TreeProps } from "@repo/ui";

/** A branch of two plus a leaf: depth, sibling order, and hideable rows. */
export const BASIC_NODES: readonly TreeNode[] = [
	{
		id: "parent",
		label: "Parent",
		children: [
			{ id: "child", label: "Child" },
			{ id: "sibling", label: "Sibling" },
		],
	},
	{ id: "last", label: "Last" },
];

export const tree = (): HTMLElement => screen.getByRole("tree");

export const row = (name: string): HTMLElement =>
	screen.getByRole("treeitem", { name });

const nameOf = (item: Element | null): string =>
	item?.getAttribute("aria-label") ?? "";

/** The visible rows, by name, in render order. */
export const rowNames = (): string[] =>
	screen.getAllByRole("treeitem").map(nameOf);

/** The row `aria-activedescendant` points at, which is the focused row. */
export const activeRow = (): string | undefined => {
	const id = tree().getAttribute("aria-activedescendant");
	const focused = id ? document.getElementById(id) : null;
	return focused ? nameOf(focused) : undefined;
};

export const selectedRows = (): string[] =>
	screen
		.getAllByRole("treeitem")
		.filter((item) => item.getAttribute("aria-selected") === "true")
		.map(nameOf);

/** The branch rows currently open, by name. */
export const expandedRows = (): string[] =>
	screen
		.getAllByRole("treeitem")
		.filter((item) => item.getAttribute("aria-expanded") === "true")
		.map(nameOf);

/**
 * Sends a key to the container, where DOM focus lives; `from` targets a row, as
 * a click leaves it. Returns false when the tree claimed the key.
 */
export const press = (key: string, from?: string): boolean =>
	fireEvent.keyDown(from ? row(from) : tree(), { key });

export const clickRow = (name: string, init?: MouseEventInit): void => {
	fireEvent.click(row(name), init);
};

/** Clicks a branch's twistie rather than its body. */
export const clickTwistie = (name: string, init?: MouseEventInit): void => {
	const chevron = row(name).querySelector(".ui-tree-item__chevron");
	if (!chevron) {
		throw new Error(`Expected a twistie on ${name}.`);
	}
	fireEvent.click(chevron, init);
};

/** A row's indent guides, outermost first: true where one is drawn active. */
export const activeGuides = (name: string): boolean[] =>
	[...row(name).querySelectorAll(".ui-tree-item__indent-slot")].map((slot) =>
		slot.classList.contains("ui-tree-item__indent-slot--active"),
	);

/** A fully controlled Tree, for tests that drive the props themselves. */
export function renderTree(props: TreeProps) {
	const view = render(<Tree {...props} />);
	return {
		...view,
		/** Re-renders with props changed, as a consumer's state would. */
		update: (next: Partial<TreeProps>): void =>
			view.rerender(<Tree {...props} {...next} />),
	};
}

function StatefulTree({
	onSelectedItemChange,
	onExpandedIdsChange,
	...props
}: TreeProps): React.JSX.Element {
	const [selectedItemId, setSelectedItemId] = useState(props.selectedItemId);
	const [expandedIds, setExpandedIds] = useState(props.expandedIds);
	return (
		<Tree
			{...props}
			selectedItemId={selectedItemId}
			onSelectedItemChange={(id) => {
				onSelectedItemChange?.(id);
				setSelectedItemId(id);
			}}
			expandedIds={expandedIds}
			onExpandedIdsChange={(ids) => {
				onExpandedIdsChange?.(ids);
				setExpandedIds(ids);
			}}
		/>
	);
}

/**
 * A Tree that keeps its own state, so a gesture's result lands in the DOM.
 * `emitted` records what it reported to its consumer, newest last.
 */
export function renderStatefulTree(props: TreeProps) {
	const selection: Array<string | undefined> = [];
	const expandedIds: Array<readonly string[]> = [];
	const view = render(
		<StatefulTree
			{...props}
			onSelectedItemChange={(id) => selection.push(id)}
			onExpandedIdsChange={(ids) => expandedIds.push(ids)}
		/>,
	);
	return { ...view, emitted: { selection, expandedIds } };
}
