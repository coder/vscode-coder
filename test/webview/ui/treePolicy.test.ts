import { describe, expect, it } from "vitest";

import {
	createTreeModel,
	type TreeModel,
	type TreeNode,
	type TreeRowModel,
} from "@repo/ui/components/Tree/treeModel";
import {
	keyboardCommands,
	pointerCommands,
	type KeyboardCommandInput,
	type PointerCommandInput,
} from "@repo/ui/components/Tree/treePolicy";

const NODES: readonly TreeNode[] = [
	{
		id: "parent",
		label: "Parent",
		children: [{ id: "child", label: "Child" }],
	},
	{ id: "last", label: "Last" },
];
const model = createTreeModel(NODES, new Set(["parent"]));
const collapsedModel = createTreeModel(NODES, new Set());
const row = (id: string, from: TreeModel = model): TreeRowModel => {
	const found = from.rowsById.get(id);
	if (!found) throw new Error(`Expected row ${id}.`);
	return found;
};

const pointer = (overrides: Partial<PointerCommandInput> = {}) =>
	pointerCommands({
		expandMode: "singleClick",
		row: row("parent"),
		onTwistie: false,
		detail: 1,
		altKey: false,
		...overrides,
	});
const keyboard = (overrides: Partial<KeyboardCommandInput> = {}) =>
	keyboardCommands({
		expandMode: "singleClick",
		key: "ArrowDown",
		row: row("parent"),
		visibleRows: model.visibleRows,
		fromAction: false,
		selectedCount: 0,
		hasFocusedRow: false,
		...overrides,
	});

const FOCUS_PARENT = { type: "focus", id: "parent" };
const SELECT_PARENT = { type: "select", id: "parent" };
const TOGGLE_PARENT = { type: "toggle", id: "parent", recursive: false };

describe("pointerCommands", () => {
	it("focuses and selects before expanding, so a click cannot reorder them", () => {
		expect(pointer()).toEqual([FOCUS_PARENT, SELECT_PARENT, TOGGLE_PARENT]);
	});

	it("keeps a twistie click off the selection, and Alt recursive", () => {
		expect(pointer({ onTwistie: true, detail: 2, altKey: true })).toEqual([
			FOCUS_PARENT,
			{ type: "toggle", id: "parent", recursive: true },
		]);
	});

	it.each([
		[1, [FOCUS_PARENT, SELECT_PARENT]],
		[2, [FOCUS_PARENT, SELECT_PARENT, TOGGLE_PARENT]],
	])("expands on click %i under doubleClick", (detail, commands) => {
		expect(pointer({ expandMode: "doubleClick", detail })).toEqual(commands);
	});

	it("leaves a leaf nothing to expand", () => {
		expect(pointer({ row: row("last") })).toEqual([
			{ type: "focus", id: "last" },
			{ type: "select", id: "last" },
		]);
	});
});

describe("keyboardCommands", () => {
	it.each([
		["ArrowDown", 1],
		["ArrowUp", -1],
	] as const)("moves the active row on %s", (key, offset) => {
		expect(keyboard({ key })).toEqual({
			commands: [{ type: "move", id: "parent", offset }],
			preventDefault: true,
			focusRowElementId: undefined,
		});
	});

	it.each([
		["Home", "parent"],
		["End", "last"],
	])("jumps to the %s row", (key, id) => {
		expect(keyboard({ key }).commands).toEqual([{ type: "focus", id }]);
	});

	it("walks into and out of branches", () => {
		expect(keyboard({ key: "ArrowRight" }).commands).toEqual([
			{ type: "focus", id: "child" },
		]);
		expect(keyboard({ key: "ArrowLeft", row: row("child") }).commands).toEqual([
			FOCUS_PARENT,
		]);
		expect(keyboard({ key: "ArrowLeft" }).commands).toEqual([TOGGLE_PARENT]);
		expect(
			keyboard({
				key: "ArrowRight",
				row: row("parent", collapsedModel),
				visibleRows: collapsedModel.visibleRows,
			}).commands,
		).toEqual([TOGGLE_PARENT]);
	});

	it("keeps selection and expansion apart on Enter and Space", () => {
		expect(keyboard({ key: "Enter" }).commands).toEqual([
			SELECT_PARENT,
			TOGGLE_PARENT,
		]);
		expect(
			keyboard({ key: "Enter", expandMode: "doubleClick" }).commands,
		).toEqual([SELECT_PARENT]);
		expect(keyboard({ key: " " }).commands).toEqual([TOGGLE_PARENT]);
		expect(keyboard({ key: " ", row: row("child") }).commands).toEqual([
			{ type: "select", id: "child" },
		]);
	});

	it.each([
		[0, false, false, false],
		[1, false, true, false],
		[1, true, true, true],
	])(
		"dismisses %i selected rows with focus %s",
		(selectedCount, hasFocusedRow, clearSelection, clearFocus) => {
			expect(
				keyboard({ key: "Escape", selectedCount, hasFocusedRow }),
			).toMatchObject({
				commands: [{ type: "dismiss", clearSelection, clearFocus }],
				preventDefault: clearSelection || hasFocusedRow,
			});
		},
	);

	it("leaves unclaimed keys, Tab included, to the host", () => {
		expect(keyboard({ key: "Tab" })).toEqual({
			commands: [],
			preventDefault: false,
			focusRowElementId: undefined,
		});
	});

	it("gives a row action its own keys and takes the navigating ones back", () => {
		expect(keyboard({ key: "Enter", fromAction: true })).toEqual({
			commands: [],
			preventDefault: false,
			focusRowElementId: undefined,
		});
		expect(keyboard({ key: "ArrowDown", fromAction: true })).toMatchObject({
			commands: [{ type: "move", id: "parent", offset: 1 }],
			preventDefault: true,
			focusRowElementId: "parent",
		});
	});
});
