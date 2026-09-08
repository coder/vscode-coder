/**
 * The interaction state props cannot hold: focus, the tab stop, and container
 * focus. `deriveTreeInteractionView` reads it against the current model and
 * resolves what the rows render; `transitionTree` folds commands into it.
 */

import { parentId, type TreeModel, type TreeRowModel } from "./treeModel";

import type { TreeCommand } from "./treePolicy";

/** The focused row, with its ancestors to fall back on if it disappears. */
interface FocusTarget {
	readonly id: string;
	readonly pathIds: readonly string[];
}

export interface TreeInteractionState {
	readonly focusTarget?: FocusTarget;
	/** The row Tab returns to, which outlives a row leaving the viewport. */
	readonly tabTargetId?: string;
	/** The selection whose tab stop the user already moved away from. */
	readonly dismissedSelectionKey?: string;
	readonly hasDomFocus: boolean;
}

/** What the rows render from, derived fresh on every render. */
interface TreeInteractionView {
	readonly state: TreeInteractionState;
	readonly controlledKey: string;
	readonly selectedIds: ReadonlySet<string>;
	readonly focusedId: string | undefined;
	readonly guideOwnerIds: ReadonlySet<string>;
	readonly tabStopId: string | undefined;
}

interface TransitionInput {
	readonly model: TreeModel;
	readonly controlledIds: readonly string[];
	readonly expandedIds: readonly string[];
}

interface TreeTransition {
	readonly state: TreeInteractionState;
	/** Set only when the commands changed it, since selection is controlled. */
	readonly selection?: readonly string[];
	readonly expandedIds?: readonly string[];
	readonly focusTree: boolean;
}

/** Selections compare by value: the ids arrive fresh in props each render. */
const selectionKey = (ids: readonly string[]): string =>
	JSON.stringify([...new Set(ids)].sort());
const NO_SELECTION_KEY = selectionKey([]);

const focusTarget = (row: TreeRowModel): FocusTarget => ({
	id: row.node.id,
	pathIds: row.pathIds,
});

export function initialTreeInteractionState(): TreeInteractionState {
	return { hasDomFocus: false };
}

/**
 * Points the state at rows the model still has, returning it unchanged when it
 * already does; callers compare by identity to spot data moving under them.
 */
function reconcile(
	state: TreeInteractionState,
	model: TreeModel,
): TreeInteractionState {
	const { rowsById, visibleIds } = model;
	if (state.focusTarget && !rowsById.has(state.focusTarget.id)) {
		const fallbackId = state.focusTarget.pathIds.findLast((id) =>
			visibleIds.has(id),
		);
		const fallback = fallbackId ? rowsById.get(fallbackId) : undefined;
		return {
			...state,
			focusTarget: fallback ? focusTarget(fallback) : undefined,
			tabTargetId: fallbackId,
		};
	}
	if (state.tabTargetId && !rowsById.has(state.tabTargetId)) {
		return { ...state, tabTargetId: undefined };
	}
	return state;
}

/** The guides VS Code draws solid: the paths down to selection and focus. */
function activeGuideOwners(
	visibleRows: readonly TreeRowModel[],
	selectedIds: ReadonlySet<string>,
	focusedId: string | undefined,
): ReadonlySet<string> {
	const owners = new Set<string>();
	for (const row of visibleRows) {
		if (!selectedIds.has(row.node.id) && focusedId !== row.node.id) {
			continue;
		}
		const ownerId = row.expanded ? row.node.id : parentId(row);
		if (ownerId) {
			owners.add(ownerId);
		}
	}
	return owners;
}

export function deriveTreeInteractionView(
	state: TreeInteractionState,
	model: TreeModel,
	controlledIds: readonly string[],
): TreeInteractionView {
	const { visibleRows, rowsById, visibleIds } = model;
	const nextState = reconcile(state, model);
	const { focusTarget: focus, tabTargetId } = nextState;
	const focusedId = focus && visibleIds.has(focus.id) ? focus.id : undefined;
	// Focus kept out of view holds the tab stop, so Tab cannot move the user.
	const hiddenFocus =
		focus !== undefined && !focusedId && rowsById.has(focus.id);
	const selectedIds = new Set(controlledIds);
	const controlledKey = selectionKey(controlledIds);
	const claimedSelection =
		nextState.dismissedSelectionKey === controlledKey
			? undefined
			: visibleRows.find((row) => selectedIds.has(row.node.id))?.node.id;
	const tabTarget =
		tabTargetId && visibleIds.has(tabTargetId) ? tabTargetId : undefined;

	return {
		state: nextState,
		controlledKey,
		selectedIds,
		focusedId,
		guideOwnerIds: activeGuideOwners(
			visibleRows,
			selectedIds,
			nextState.hasDomFocus ? focusedId : undefined,
		),
		tabStopId:
			claimedSelection ??
			tabTarget ??
			(hiddenFocus ? undefined : visibleRows[0]?.node.id),
	};
}

/** Adopts `row` as the focused row on first entry, never after. */
export function treeFocusChanged(
	state: TreeInteractionState,
	focused: boolean,
	row?: TreeRowModel,
): TreeInteractionState {
	if (!focused) {
		return state.hasDomFocus ? { ...state, hasDomFocus: false } : state;
	}
	return {
		...state,
		focusTarget: state.focusTarget ?? (row ? focusTarget(row) : undefined),
		hasDomFocus: true,
	};
}

/** Focus moved to `row`, which also becomes the tab stop from now on. */
export function rowFocused(
	state: TreeInteractionState,
	row: TreeRowModel,
	controlledKey: string,
): TreeInteractionState {
	return {
		...state,
		focusTarget: focusTarget(row),
		tabTargetId: row.node.id,
		dismissedSelectionKey: controlledKey,
	};
}

function togglingBranches(
	row: TreeRowModel,
	model: TreeModel,
	recursive: boolean,
): readonly TreeRowModel[] {
	if (!recursive) {
		return [row];
	}
	return model.rows.filter(
		(candidate) =>
			candidate.node.children !== undefined &&
			(candidate === row || candidate.pathIds.includes(row.node.id)),
	);
}

/**
 * Expansion is data, so the ids come back in tree order. Ids the data does not
 * have are kept, so a branch that loads later reopens.
 */
function toggleExpansion(
	row: TreeRowModel,
	model: TreeModel,
	expandedIds: readonly string[],
	recursive: boolean,
): readonly string[] {
	const next = new Set(expandedIds);
	for (const branch of togglingBranches(row, model, recursive)) {
		if (row.expanded) {
			next.delete(branch.node.id);
		} else {
			next.add(branch.node.id);
		}
	}
	return [
		...model.rows
			.filter((candidate) => next.has(candidate.node.id))
			.map((candidate) => candidate.node.id),
		...[...next].filter((id) => !model.rowsById.has(id)),
	];
}

export function transitionTree(
	state: TreeInteractionState,
	commands: readonly TreeCommand[],
	input: TransitionInput,
): TreeTransition {
	const { model } = input;
	const view = deriveTreeInteractionView(state, model, input.controlledIds);
	let nextState = view.state;
	let currentKey = view.controlledKey;
	let selection: readonly string[] | undefined;
	let expandedIds: readonly string[] | undefined;
	let focusTree = false;

	const select = (ids: ReadonlySet<string>): void => {
		selection = model.rows
			.filter((row) => ids.has(row.node.id))
			.map((row) => row.node.id);
		currentKey = selectionKey(selection);
		nextState = { ...nextState, dismissedSelectionKey: currentKey };
	};
	const focus = (row: TreeRowModel | undefined): void => {
		if (!row || !model.visibleIds.has(row.node.id)) {
			return;
		}
		nextState = rowFocused(nextState, row, currentKey);
		focusTree = true;
	};

	for (const command of commands) {
		const row = "id" in command ? model.rowsById.get(command.id) : undefined;
		switch (command.type) {
			case "focus":
				focus(row);
				break;
			case "select":
				if (row) {
					select(new Set([row.node.id]));
				}
				break;
			case "move": {
				if (!row) {
					break;
				}
				const rows = model.visibleRows;
				const index = rows.indexOf(row) + command.offset;
				focus(rows[Math.min(Math.max(index, 0), rows.length - 1)]);
				break;
			}
			case "toggle":
				if (row?.expanded !== undefined) {
					expandedIds = toggleExpansion(
						row,
						model,
						expandedIds ?? input.expandedIds,
						command.recursive,
					);
				}
				break;
			case "dismiss":
				if (command.clearSelection) {
					select(new Set());
				}
				if (command.clearFocus) {
					nextState = { ...nextState, focusTarget: undefined };
					focusTree = true;
				}
				currentKey = NO_SELECTION_KEY;
				break;
		}
	}
	return { state: nextState, selection, expandedIds, focusTree };
}
