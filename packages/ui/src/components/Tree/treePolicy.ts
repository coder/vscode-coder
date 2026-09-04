/**
 * The VS Code key and pointer bindings, as the commands a gesture means for a
 * row. "Policy" because it decides intent only: `treeTransition.ts` applies it.
 */

import { parentId, type TreeRowModel } from "./treeModel";

/** Mirrors `workbench.tree.expandMode`, values included. */
export type TreeExpandMode = "singleClick" | "doubleClick";

interface TreeCommandBehavior {
	readonly expandMode: TreeExpandMode;
}

type RowCommand<Type extends string, Options = object> = {
	readonly type: Type;
	readonly id: string;
} & Options;

export type TreeCommand =
	| RowCommand<"focus">
	| RowCommand<"move", { readonly offset: -1 | 1 }>
	| RowCommand<"select">
	| RowCommand<"toggle", { readonly recursive: boolean }>
	| {
			readonly type: "dismiss";
			readonly clearSelection: boolean;
			readonly clearFocus: boolean;
	  };

export interface PointerCommandInput extends TreeCommandBehavior {
	readonly row: TreeRowModel;
	readonly onTwistie: boolean;
	/** `MouseEvent.detail`, so 2 on a double click. */
	readonly detail: number;
	readonly altKey: boolean;
}

export interface KeyboardCommandInput extends TreeCommandBehavior {
	readonly key: string;
	readonly row: TreeRowModel;
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
	"Home",
	"End",
]);

const focusCommand = (id: string): TreeCommand => ({ type: "focus", id });
const selectCommand = (id: string): TreeCommand => ({ type: "select", id });
const toggleCommand = (id: string, recursive = false): TreeCommand => ({
	type: "toggle",
	id,
	recursive,
});

/** The commands a click on `row` means, twistie clicks included. */
export function pointerCommands(
	input: PointerCommandInput,
): readonly TreeCommand[] {
	const { row, expandMode, detail } = input;
	const id = row.node.id;
	const toggle = toggleCommand(id, input.altKey);
	if (input.onTwistie) {
		return [focusCommand(id), toggle];
	}
	const togglesBody =
		row.expanded !== undefined &&
		(expandMode === "singleClick" ? detail <= 1 : detail === 2);
	return togglesBody
		? [focusCommand(id), selectCommand(id), toggle]
		: [focusCommand(id), selectCommand(id)];
}

/** The commands a key press means, plus who keeps the event afterwards. */
export function keyboardCommands(input: KeyboardCommandInput): KeyboardOutcome {
	const { key, row, visibleRows } = input;
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

	switch (key) {
		case "ArrowDown":
		case "ArrowUp":
			return outcome([
				{ type: "move", id, offset: key === "ArrowDown" ? 1 : -1 },
			]);
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
			const alsoToggles =
				row.expanded !== undefined && input.expandMode === "singleClick";
			return outcome(
				alsoToggles
					? [selectCommand(id), toggleCommand(id)]
					: [selectCommand(id)],
			);
		}
		case " ":
			// A leaf has nothing to toggle, so Space selects it instead.
			return outcome([
				row.expanded === undefined ? selectCommand(id) : toggleCommand(id),
			]);
		case "Escape": {
			const clearSelection = input.selectedCount > 0;
			const clearFocus = input.selectedCount <= 1 && input.hasFocusedRow;
			return outcome(
				[{ type: "dismiss", clearSelection, clearFocus }],
				clearSelection || input.hasFocusedRow,
			);
		}
		default:
			// Anything the tree does not handle stays with the host, Tab included.
			return outcome(NO_COMMANDS, false);
	}
}
