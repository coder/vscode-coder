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
	type TreeModifiers,
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

const NO_MODIFIERS: TreeModifiers = {
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
};
/** The modifiers a gesture holds down, by name. */
const held = (...pressed: Array<keyof TreeModifiers>): TreeModifiers => ({
	...NO_MODIFIERS,
	...Object.fromEntries(pressed.map((key) => [key, true])),
});

const pointer = (overrides: Partial<PointerCommandInput> = {}) =>
	pointerCommands({
		expandMode: "singleClick",
		multiSelect: false,
		multiSelectModifier: "ctrlCmd",
		row: row("parent"),
		source: "row",
		onTwistie: false,
		detail: 1,
		modifiers: NO_MODIFIERS,
		...overrides,
	});
const keyboard = (overrides: Partial<KeyboardCommandInput> = {}) =>
	keyboardCommands({
		expandMode: "singleClick",
		multiSelect: false,
		multiSelectModifier: "ctrlCmd",
		key: "ArrowDown",
		row: row("parent"),
		visibleRows: model.visibleRows,
		fromAction: false,
		selectedCount: 0,
		hasFocusedRow: false,
		modifiers: NO_MODIFIERS,
		...overrides,
	});

const FOCUS_PARENT = { type: "focus", id: "parent" };
const TOGGLE_PARENT = { type: "toggle", id: "parent", recursive: false };
/** Selects replace the selection and keep hidden rows unless told otherwise. */
const select = (
	id: string,
	options: { toggle?: boolean; range?: boolean; preserveHidden?: boolean } = {},
) => ({
	type: "select",
	id,
	toggle: false,
	range: false,
	preserveHidden: true,
	...options,
});

describe("pointerCommands", () => {
	it("focuses and selects before expanding, so a click cannot reorder them", () => {
		expect(pointer()).toEqual([
			{ type: "focus", id: "parent" },
			{
				type: "select",
				id: "parent",
				toggle: false,
				range: false,
				preserveHidden: true,
			},
			{ type: "toggle", id: "parent", recursive: false },
		]);
	});

	it("keeps a twistie click off the selection, and Alt recursive", () => {
		expect(
			pointer({ onTwistie: true, detail: 2, modifiers: held("altKey") }),
		).toEqual([
			FOCUS_PARENT,
			{ type: "toggle", id: "parent", recursive: true },
		]);
	});

	it("leaves Alt to selection when it is the selection modifier", () => {
		expect(
			pointer({
				onTwistie: true,
				multiSelect: true,
				multiSelectModifier: "alt",
				modifiers: held("altKey"),
			}),
		).toEqual([
			FOCUS_PARENT,
			select("parent", { toggle: true, preserveHidden: false }),
		]);
	});

	it.each([
		[1, [FOCUS_PARENT, select("parent")]],
		[2, [FOCUS_PARENT, select("parent"), TOGGLE_PARENT]],
	])("expands on click %i under doubleClick", (detail, commands) => {
		expect(pointer({ expandMode: "doubleClick", detail })).toEqual(commands);
	});

	it("leaves a leaf nothing to expand", () => {
		expect(pointer({ row: row("last") })).toEqual([
			{ type: "focus", id: "last" },
			select("last"),
		]);
	});

	it("gives a selection gesture precedence over twistie expansion", () => {
		expect(
			pointer({
				multiSelect: true,
				onTwistie: true,
				modifiers: held("ctrlKey", "shiftKey"),
			}),
		).toEqual([
			FOCUS_PARENT,
			select("parent", { toggle: true, range: true, preserveHidden: false }),
		]);
	});

	it("selects from a pinned row without expanding it, twistie aside", () => {
		expect(pointer({ source: "sticky" })).toEqual([
			FOCUS_PARENT,
			select("parent"),
		]);
		expect(pointer({ source: "sticky", onTwistie: true })).toEqual([
			FOCUS_PARENT,
			select("parent"),
			TOGGLE_PARENT,
		]);
		// A selection gesture on a pinned row never moves focus to it.
		expect(
			pointer({
				source: "sticky",
				multiSelect: true,
				modifiers: held("shiftKey"),
			}),
		).toEqual([select("parent", { range: true, preserveHidden: false })]);
	});
});

describe("keyboardCommands", () => {
	it.each([
		["ArrowDown", 1, false],
		["ArrowUp", -1, false],
		["PageDown", 1, true],
		["PageUp", -1, true],
	] as const)("moves the active row on %s", (key, offset, page) => {
		expect(keyboard({ key })).toEqual({
			commands: [{ type: "move", id: "parent", offset, page, extend: false }],
			preventDefault: true,
			focusRowElementId: undefined,
		});
	});

	it("extends the selection with Shift, but never by the page", () => {
		expect(
			keyboard({ multiSelect: true, modifiers: held("shiftKey") }).commands,
		).toEqual([
			{ type: "move", id: "parent", offset: 1, page: false, extend: true },
		]);
		expect(
			keyboard({
				key: "PageDown",
				multiSelect: true,
				modifiers: held("shiftKey"),
			}).commands,
		).toEqual([
			{ type: "move", id: "parent", offset: 1, page: true, extend: false },
		]);
		// Shift alone extends nothing without multi-selection.
		expect(keyboard({ modifiers: held("shiftKey") }).commands).toEqual([
			{ type: "move", id: "parent", offset: 1, page: false, extend: false },
		]);
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
			select("parent"),
			TOGGLE_PARENT,
		]);
		expect(
			keyboard({ key: "Enter", expandMode: "doubleClick" }).commands,
		).toEqual([select("parent")]);
		expect(keyboard({ key: " " }).commands).toEqual([TOGGLE_PARENT]);
		expect(keyboard({ key: " ", row: row("child") }).commands).toEqual([
			select("child"),
		]);
	});

	it("adds to the selection with the selection modifier held", () => {
		expect(
			keyboard({
				key: "Enter",
				multiSelect: true,
				modifiers: held("ctrlKey", "shiftKey"),
			}).commands,
		).toEqual([select("parent", { toggle: true })]);
		expect(
			keyboard({
				key: " ",
				row: row("child"),
				multiSelect: true,
				modifiers: held("metaKey"),
			}).commands,
		).toEqual([select("child", { toggle: true })]);
		expect(
			keyboard({ key: "a", multiSelect: true, modifiers: held("ctrlKey") })
				.commands,
		).toEqual([{ type: "selectScope", id: "parent" }]);
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

	it("types ahead on a bare printable key, and leaves the rest to the host", () => {
		expect(keyboard({ key: "B" })).toMatchObject({
			commands: [{ type: "typeahead", id: "parent", key: "b" }],
			preventDefault: true,
		});
		expect(keyboard({ key: "b", modifiers: held("ctrlKey") })).toEqual({
			commands: [],
			preventDefault: false,
			focusRowElementId: undefined,
		});
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
			commands: [
				{ type: "move", id: "parent", offset: 1, page: false, extend: false },
			],
			preventDefault: true,
			focusRowElementId: "parent",
		});
	});
});
