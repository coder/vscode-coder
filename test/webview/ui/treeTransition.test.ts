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
	const state = initialTreeInteractionState();
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
	} = {},
) =>
	transitionTree(state, commands, {
		model,
		controlledIds: overrides.controlledIds ?? [],
		expandedIds: overrides.expandedIds ?? ["parent"],
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
		const claimed = transition(state, [{ type: "select", id: "last" }], OPEN);
		expect(view(claimed.state, OPEN, ["last"]).tabStopId).toBe("parent");
	});

	it("draws guides down to the selected row, and the focused one when in focus", () => {
		const selected = view(initialTreeInteractionState(), OPEN, ["child"]);
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
			[{ type: "move", id: "parent", offset: 1 }],
			OPEN,
		);
		expect(down.state.focusTarget?.id).toBe("child");
		const up = transition(
			state,
			[{ type: "move", id: "parent", offset: -1 }],
			OPEN,
		);
		expect(up.state.focusTarget?.id).toBe("parent");
	});

	it("emits expansion in tree order, keeping ids the data does not have yet", () => {
		const expanded = transition(
			initialTreeInteractionState(),
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
			initialTreeInteractionState(),
			[{ type: "toggle", id: "root", recursive: true }],
			nested,
			{ expandedIds: ["one"] },
		);
		expect(expanded.expandedIds).toEqual(["root", "one", "two"]);
	});
});
