import { describe, expect, it } from "vitest";

import {
	createTreeModel,
	type TreeModel,
	type TreeNode,
	type TreeRowModel,
} from "@repo/ui/components/Tree/treeModel";
import {
	deriveTreeInteractionView,
	initialTreeInteractionState,
	rowFocused,
	transitionTree,
	type TreeInteractionState,
} from "@repo/ui/components/Tree/treeTransition";

const NODES: readonly TreeNode[] = [
	{
		id: "parent",
		label: "Parent",
		children: [{ id: "child", label: "Child" }],
	},
	{ id: "last", label: "Last" },
];
const OPEN = createTreeModel(NODES, new Set(["parent"]));
const CLOSED = createTreeModel(NODES, new Set());

const rowOf = (model: TreeModel, id: string): TreeRowModel => {
	const row = model.rowsById.get(id);
	if (!row) throw new Error(`Expected row ${id}.`);
	return row;
};

/** Focuses a row the way a click does, through the view's own selection key. */
function focusRow(
	id: string,
	model: TreeModel,
	controlledIds: readonly string[] = [],
): TreeInteractionState {
	const state = initialTreeInteractionState(controlledIds);
	const { controlledKey } = deriveTreeInteractionView(
		state,
		model,
		controlledIds,
	);
	return rowFocused(state, rowOf(model, id), controlledKey);
}

const view = (
	state: TreeInteractionState,
	model: TreeModel,
	controlledIds: readonly string[] = [],
) => deriveTreeInteractionView(state, model, controlledIds);

const transition = (
	state: TreeInteractionState,
	commands: Parameters<typeof transitionTree>[1],
	model: TreeModel,
	overrides: {
		expandedIds?: readonly string[];
		controlledIds?: readonly string[];
		multiSelect?: boolean;
		now?: number;
	} = {},
) =>
	transitionTree(state, commands, {
		model,
		controlledIds: overrides.controlledIds ?? [],
		expandedIds: overrides.expandedIds ?? ["parent"],
		multiSelect: overrides.multiSelect ?? false,
		now: overrides.now ?? 0,
	});

describe("deriveTreeInteractionView", () => {
	it("returns the state untouched while every remembered row still exists", () => {
		const state = focusRow("child", OPEN);
		expect(view(state, OPEN).state).toBe(state);
		expect(view(state, OPEN).focusedId).toBe("child");
	});

	it("keeps focus on a row a collapse only hid", () => {
		const hidden = view(focusRow("child", OPEN), CLOSED);
		expect(hidden.state.focusTarget?.id).toBe("child");
		expect(hidden.focusedId).toBeUndefined();
		// The tab stop stays away from the first row, which would move the user.
		expect(hidden.tabStopId).toBeUndefined();
	});

	it("falls back to the nearest visible ancestor when the row is gone", () => {
		const removed = createTreeModel(
			[{ id: "parent", label: "Parent", children: [] }, NODES[1]],
			new Set(["parent"]),
		);
		const reconciled = view(focusRow("child", OPEN), removed);
		expect(reconciled.state.focusTarget?.id).toBe("parent");
		expect(reconciled.state.tabTargetId).toBe("parent");
		expect(reconciled.focusedId).toBe("parent");
	});

	it("gives an unclaimed selection the tab stop, until focus claims it", () => {
		const state = focusRow("parent", OPEN);
		expect(view(state, OPEN, ["last"]).tabStopId).toBe("last");
		const claimed = transition(
			state,
			[
				{
					type: "select",
					id: "last",
					toggle: false,
					range: false,
					preserveHidden: true,
				},
			],
			OPEN,
		);
		expect(view(claimed.state, OPEN, ["last"]).tabStopId).toBe("parent");
	});

	it("draws guides down to the selected row, and the focused one when in focus", () => {
		const selected = view(initialTreeInteractionState([]), OPEN, ["child"]);
		expect([...selected.guideOwnerIds]).toEqual(["parent"]);
		const blurred = view(focusRow("child", OPEN), OPEN);
		expect([...blurred.guideOwnerIds]).toEqual([]);
	});
});

describe("transitionTree", () => {
	it("clears the selection on dismiss, and focus only when asked", () => {
		const state = focusRow("child", OPEN, ["child"]);
		const selectionOnly = transition(
			state,
			[{ type: "dismiss", clearSelection: true, clearFocus: false }],
			OPEN,
			{ controlledIds: ["child"] },
		);
		expect(selectionOnly.selection).toEqual([]);
		expect(selectionOnly.state.focusTarget?.id).toBe("child");

		const cleared = transition(
			state,
			[{ type: "dismiss", clearSelection: true, clearFocus: true }],
			OPEN,
			{ controlledIds: ["child"] },
		);
		expect(cleared.state.focusTarget).toBeUndefined();
		// Tab still returns to where the user was.
		expect(cleared.state.tabTargetId).toBe("child");
	});

	it("moves focus within the visible rows, clamped at both ends", () => {
		const state = focusRow("parent", OPEN);
		const down = transition(
			state,
			[{ type: "move", id: "parent", offset: 1, page: false, extend: false }],
			OPEN,
		);
		expect(down.state.focusTarget?.id).toBe("child");
		const up = transition(
			state,
			[{ type: "move", id: "parent", offset: -1, page: false, extend: false }],
			OPEN,
		);
		expect(up.state.focusTarget?.id).toBe("parent");
	});

	it("emits expansion in tree order, keeping ids the data does not have yet", () => {
		const expanded = transition(
			initialTreeInteractionState([]),
			[{ type: "toggle", id: "parent", recursive: false }],
			CLOSED,
			{ expandedIds: ["ghost"] },
		);
		expect(expanded.expandedIds).toEqual(["parent", "ghost"]);
	});

	it("toggles every branch under a recursive toggle", () => {
		const nested = createTreeModel(
			[
				{
					id: "root",
					label: "Root",
					children: [
						{ id: "one", label: "One", children: [] },
						{ id: "two", label: "Two", children: [] },
					],
				},
			],
			new Set(["one"]),
		);
		const expanded = transition(
			initialTreeInteractionState([]),
			[{ type: "toggle", id: "root", recursive: true }],
			nested,
			{ expandedIds: ["one"] },
		);
		expect(expanded.expandedIds).toEqual(["root", "one", "two"]);
	});
});

describe("multi-selection", () => {
	const withSelection = (ids: readonly string[]) => ({
		controlledIds: ids,
		multiSelect: true,
	});

	it("keeps the anchor when a controlled selection only reorders", () => {
		const state = initialTreeInteractionState(["child", "last"]);
		expect(view(state, OPEN, ["last", "child"]).anchorId).toBe("child");
	});

	it("adds to and removes from the selection when toggling", () => {
		const added = transition(
			initialTreeInteractionState(["child"]),
			[
				{
					type: "select",
					id: "last",
					toggle: true,
					range: false,
					preserveHidden: true,
				},
			],
			OPEN,
			withSelection(["child"]),
		);
		expect(added.selection).toEqual(["child", "last"]);
		const removed = transition(
			initialTreeInteractionState(["child", "last"]),
			[
				{
					type: "select",
					id: "last",
					toggle: true,
					range: false,
					preserveHidden: true,
				},
			],
			OPEN,
			withSelection(["child", "last"]),
		);
		expect(removed.selection).toEqual(["child"]);
	});

	it("selects the range from the anchor, in tree order", () => {
		const anchored = focusRow("parent", OPEN, ["parent"]);
		const ranged = transition(
			anchored,
			[
				{
					type: "select",
					id: "last",
					toggle: false,
					range: true,
					preserveHidden: false,
				},
			],
			OPEN,
			withSelection(["parent"]),
		);
		expect(ranged.selection).toEqual(["parent", "child", "last"]);
	});

	it("extends the selection as a Shift move travels", () => {
		const extended = transition(
			initialTreeInteractionState(["parent"]),
			[{ type: "move", id: "parent", offset: 1, page: false, extend: true }],
			OPEN,
			withSelection(["parent"]),
		);
		expect(extended.selection).toEqual(["parent", "child"]);
		expect(extended.state.focusTarget?.id).toBe("child");
	});

	it("moves a page by the offset the scroller measured", () => {
		const paged = transition(
			initialTreeInteractionState([]),
			[{ type: "move", id: "parent", offset: 1, page: true, extend: false }],
			OPEN,
		);
		expect(paged.state.focusTarget?.id).toBe("child");
	});

	it("scopes select-all to the sibling group, then widens to the parent", () => {
		const group = transition(
			initialTreeInteractionState([]),
			[{ type: "selectScope", id: "child" }],
			OPEN,
			withSelection([]),
		);
		expect(group.selection).toEqual(["child"]);
		const widened = transition(
			initialTreeInteractionState(["child"]),
			[{ type: "selectScope", id: "child" }],
			OPEN,
			withSelection(["child"]),
		);
		expect(widened.selection).toEqual(["parent", "child"]);
	});

	it("resets the anchor on dismiss", () => {
		const dismissed = transition(
			focusRow("child", OPEN, ["child"]),
			[{ type: "dismiss", clearSelection: true, clearFocus: false }],
			OPEN,
			{ controlledIds: ["child"] },
		);
		expect(dismissed.state.anchorId).toBeUndefined();
	});

	it("buffers type-ahead keys until the query expires", () => {
		const first = transition(
			initialTreeInteractionState([]),
			[{ type: "typeahead", id: "parent", key: "l" }],
			OPEN,
			{ now: 1000 },
		);
		expect(first.state.focusTarget?.id).toBe("last");
		expect(first.state.typeQuery).toBe("l");
		// Within the window the keys join into one query; after it they do not.
		const joined = transition(
			first.state,
			[{ type: "typeahead", id: "last", key: "a" }],
			OPEN,
			{ now: 1100 },
		);
		expect(joined.state.typeQuery).toBe("la");
		const expired = transition(
			first.state,
			[{ type: "typeahead", id: "last", key: "a" }],
			OPEN,
			{ now: 9000 },
		);
		expect(expired.state.typeQuery).toBe("a");
	});
});
