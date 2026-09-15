/**
 * The VS Code key and pointer bindings, as the commands a gesture means for a
 * row. "Policy" because it decides intent only: `treeTransition.ts` applies it.
 */

import { parentId, type TreeRowModel } from "./treeModel";

/** Mirrors `workbench.tree.expandMode`, values included. */
export type TreeExpandMode = "singleClick" | "doubleClick";

/** Mirrors `workbench.list.multiSelectModifier`, values included. */
export type TreeMultiSelectModifier = "ctrlCmd" | "alt";

export interface TreeCommandBehavior {
	readonly expandMode: TreeExpandMode;
	readonly multiSelect: boolean;
	readonly multiSelectModifier: TreeMultiSelectModifier;
}

/** The modifier keys a gesture carries, as a DOM event reports them. */
export interface TreeModifiers {
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
}

interface SelectOptions {
	/** Adds to or removes from the selection instead of replacing it. */
	readonly toggle: boolean;
	/** Selects from the anchor through this row. */
	readonly range: boolean;
	/** Whether selected rows hidden under a collapsed branch survive. */
	readonly preserveHidden: boolean;
}

type RowCommand<Type extends string, Options = object> = {
	readonly type: Type;
	readonly id: string;
} & Options;

export type TreeCommand =
	| RowCommand<"focus">
	/** Selects the row's sibling group, widening to its parent once full. */
	| RowCommand<"selectScope">
	| RowCommand<
			"move",
			{
				readonly offset: -1 | 1;
				/** A viewport's worth of rows rather than one. */
				readonly page: boolean;
				/** Extends the selection to the row moved to. */
				readonly extend: boolean;
			}
	  >
	| RowCommand<"select", SelectOptions>
	| RowCommand<"toggle", { readonly recursive: boolean }>
	| RowCommand<"typeahead", { readonly key: string }>
	| {
			readonly type: "dismiss";
			readonly clearSelection: boolean;
			readonly clearFocus: boolean;
	  };

interface CommandInput extends TreeCommandBehavior {
	readonly row: TreeRowModel;
	readonly modifiers: TreeModifiers;
}

export interface PointerCommandInput extends CommandInput {
	/** A pinned row selects without the expand-on-click its body would get. */
	readonly source: "row" | "sticky";
	readonly onTwistie: boolean;
	/** `MouseEvent.detail`, so 2 on a double click. */
	readonly detail: number;
}

export interface KeyboardCommandInput extends CommandInput {
	readonly key: string;
	readonly visibleRows: readonly TreeRowModel[];
	/** Whether a control inside the row, not the row, has focus. */
	readonly fromAction: boolean;
	readonly selectedCount: number;
	readonly hasFocusedRow: boolean;
}

interface KeyboardOutcome {
	readonly commands: readonly TreeCommand[];
	readonly preventDefault: boolean;
	/** Set when a row action navigates, so the row takes focus back. */
	readonly focusRowElementId: string | undefined;
}

const NO_COMMANDS: readonly TreeCommand[] = [];

/** The keys the tree claims even while a row action has focus. */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
	"ArrowDown",
	"ArrowUp",
	"ArrowLeft",
	"ArrowRight",
	"PageDown",
	"PageUp",
	"Home",
	"End",
]);

const focusCommand = (id: string): TreeCommand => ({ type: "focus", id });
const selectCommand = (
	id: string,
	options: Partial<SelectOptions> = {},
): TreeCommand => ({
	type: "select",
	id,
	toggle: false,
	range: false,
	preserveHidden: true,
	...options,
});
const toggleCommand = (id: string, recursive = false): TreeCommand => ({
	type: "toggle",
	id,
	recursive,
});

/** Whether the gesture adds to the selection rather than replacing it. */
export function isSelectionModifier(
	modifiers: TreeModifiers,
	behavior: TreeCommandBehavior,
): boolean {
	if (!behavior.multiSelect) {
		return false;
	}
	return behavior.multiSelectModifier === "alt"
		? modifiers.altKey
		: modifiers.ctrlKey || modifiers.metaKey;
}

/** Whether the gesture is about selection at all, ranges included. */
export function isSelectionGesture(
	modifiers: TreeModifiers,
	behavior: TreeCommandBehavior,
): boolean {
	return (
		isSelectionModifier(modifiers, behavior) ||
		(behavior.multiSelect && modifiers.shiftKey)
	);
}

/** The commands a click on `row` means, twistie clicks included. */
export function pointerCommands(
	input: PointerCommandInput,
): readonly TreeCommand[] {
	const { row, source, expandMode, detail, modifiers } = input;
	const id = row.node.id;

	if (isSelectionGesture(modifiers, input)) {
		// Hidden rows drop out: a selection the user cannot see cannot be judged.
		const select = selectCommand(id, {
			toggle: isSelectionModifier(modifiers, input),
			range: modifiers.shiftKey,
			preserveHidden: false,
		});
		return source === "sticky" ? [select] : [focusCommand(id), select];
	}

	// Alt expands recursively unless it is the selection modifier.
	const toggle = toggleCommand(
		id,
		modifiers.altKey && input.multiSelectModifier !== "alt",
	);
	if (input.onTwistie) {
		return source === "sticky"
			? [focusCommand(id), selectCommand(id), toggle]
			: [focusCommand(id), toggle];
	}
	const togglesBody =
		source === "row" &&
		row.expanded !== undefined &&
		(expandMode === "singleClick" ? detail <= 1 : detail === 2);
	return togglesBody
		? [focusCommand(id), selectCommand(id), toggle]
		: [focusCommand(id), selectCommand(id)];
}

/** The commands a key press means, plus who keeps the event afterwards. */
export function keyboardCommands(input: KeyboardCommandInput): KeyboardOutcome {
	const { key, row, visibleRows, modifiers } = input;
	const id = row.node.id;
	// A key pressed inside a row action belongs to it, unless it navigates.
	if (input.fromAction && !NAVIGATION_KEYS.has(key)) {
		return {
			commands: NO_COMMANDS,
			preventDefault: false,
			focusRowElementId: undefined,
		};
	}
	const outcome = (
		commands: readonly TreeCommand[],
		preventDefault = true,
	): KeyboardOutcome => ({
		commands,
		preventDefault,
		focusRowElementId: input.fromAction ? id : undefined,
	});
	const selectionModifier = isSelectionModifier(modifiers, input);

	// Ctrl/Cmd+A, which native scopes to the sibling group before widening.
	if (
		selectionModifier &&
		!modifiers.shiftKey &&
		key.toLocaleLowerCase() === "a"
	) {
		return outcome([{ type: "selectScope", id }]);
	}

	switch (key) {
		case "ArrowDown":
		case "ArrowUp":
		case "PageDown":
		case "PageUp": {
			const page = key === "PageDown" || key === "PageUp";
			const offset = key === "ArrowDown" || key === "PageDown" ? 1 : -1;
			return outcome([
				{
					type: "move",
					id,
					offset,
					page,
					extend: !page && input.multiSelect && modifiers.shiftKey,
				},
			]);
		}
		case "Home":
		case "End": {
			const target = key === "Home" ? visibleRows[0] : visibleRows.at(-1);
			return outcome(target ? [focusCommand(target.node.id)] : NO_COMMANDS);
		}
		case "ArrowRight": {
			if (row.expanded === false) {
				return outcome([toggleCommand(id)]);
			}
			const child = row.expanded
				? visibleRows[visibleRows.indexOf(row) + 1]
				: undefined;
			return outcome(
				child?.pathIds.includes(id)
					? [focusCommand(child.node.id)]
					: NO_COMMANDS,
			);
		}
		case "ArrowLeft": {
			if (row.expanded === true) {
				return outcome([toggleCommand(id)]);
			}
			const parent = parentId(row);
			return outcome(parent ? [focusCommand(parent)] : NO_COMMANDS);
		}
		case "Enter": {
			// Ctrl+Shift+Enter toggles this row and leaves the rest selected.
			if (selectionModifier && modifiers.shiftKey) {
				return outcome([selectCommand(id, { toggle: true })]);
			}
			const select = selectCommand(id, { toggle: selectionModifier });
			const alsoToggles =
				row.expanded !== undefined && input.expandMode === "singleClick";
			return outcome(alsoToggles ? [select, toggleCommand(id)] : [select]);
		}
		case " ":
			// A leaf has nothing to toggle, so Space selects it instead.
			return outcome([
				row.expanded === undefined
					? selectCommand(id, { toggle: selectionModifier })
					: toggleCommand(id),
			]);
		case "Escape": {
			const clearSelection = input.selectedCount > 0;
			const clearFocus = input.selectedCount <= 1 && input.hasFocusedRow;
			return outcome(
				[{ type: "dismiss", clearSelection, clearFocus }],
				clearSelection || input.hasFocusedRow,
			);
		}
		default: {
			// A bare printable key types ahead; anything else is the host's.
			const typesAhead =
				key.length === 1 &&
				!modifiers.ctrlKey &&
				!modifiers.metaKey &&
				!modifiers.altKey;
			return outcome(
				typesAhead
					? [{ type: "typeahead", id, key: key.toLocaleLowerCase() }]
					: NO_COMMANDS,
				typesAhead,
			);
		}
	}
}
