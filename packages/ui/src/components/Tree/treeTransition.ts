/**
 * The interaction state props cannot hold: focus, the tab stop, the selection
 * anchor, the type-ahead buffer, and container focus. `deriveTreeInteractionView`
 * reads it against the current model and resolves what the rows render;
 * `transitionTree` folds commands into it.
 */

import { parentId, type TreeModel, type TreeRowModel } from "./treeModel";

import type { TreeCommand } from "./treePolicy";

/** How long a type-ahead query keeps collecting keys, as in the native list. */
const TYPE_QUERY_MS = 800;

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
	/** The selection the anchor belongs to; a new one from props resets it. */
	readonly anchorKey: string;
	/** Where a range selection measures from. */
	readonly anchorId?: string;
	readonly hasDomFocus: boolean;
	readonly typeQuery?: string;
	readonly typeExpires?: number;
}

/** What the rows render from, derived fresh on every render. */
interface TreeInteractionView {
	readonly state: TreeInteractionState;
	readonly controlledKey: string;
	readonly selectedIds: ReadonlySet<string>;
	readonly focusedId: string | undefined;
	readonly anchorId: string | undefined;
	readonly guideOwnerIds: ReadonlySet<string>;
	readonly tabStopId: string | undefined;
}

interface TransitionInput {
	readonly model: TreeModel;
	readonly controlledIds: readonly string[];
	readonly expandedIds: readonly string[];
	readonly multiSelect: boolean;
	/** Rows a page key should travel, measured against the scroller. */
	readonly pageOffset?: number;
	readonly now: number;
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

export function initialTreeInteractionState(
	controlledIds: readonly string[],
): TreeInteractionState {
	return {
		anchorKey: selectionKey(controlledIds),
		anchorId: controlledIds[0],
		hasDomFocus: false,
	};
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
		anchorId:
			nextState.anchorKey === controlledKey
				? nextState.anchorId
				: controlledIds[0],
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

/**
 * The native range: the run of selected rows around the anchor is released
 * first, so shrinking a range back over itself deselects what it passes.
 */
function selectionRange(
	visibleRows: readonly TreeRowModel[],
	selectedIds: ReadonlySet<string>,
	anchorId: string,
	targetId: string,
): Set<string> | undefined {
	const rowIds = visibleRows.map((row) => row.node.id);
	const anchor = rowIds.indexOf(anchorId);
	const target = rowIds.indexOf(targetId);
	if (anchor < 0 || target < 0) {
		return undefined;
	}
	const ids = new Set(selectedIds);
	let start = anchor;
	let end = anchor;
	while (start > 0 && ids.has(rowIds[start - 1] ?? "")) {
		start--;
	}
	while (end < rowIds.length - 1 && ids.has(rowIds[end + 1] ?? "")) {
		end++;
	}
	for (const id of rowIds.slice(start, end + 1)) {
		ids.delete(id);
	}
	for (const id of rowIds.slice(
		Math.min(anchor, target),
		Math.max(anchor, target) + 1,
	)) {
		ids.add(id);
	}
	return ids;
}

interface SelectionResult {
	readonly ids: ReadonlySet<string>;
	readonly anchorId: string;
}

/** The selection a `select` command produces, and the anchor it leaves. */
function selectRow(
	model: TreeModel,
	selectedIds: ReadonlySet<string>,
	anchorId: string | undefined,
	multiSelect: boolean,
	row: TreeRowModel,
	options: { toggle: boolean; range: boolean; preserveHidden: boolean },
): SelectionResult {
	const id = row.node.id;
	if (!multiSelect) {
		return { ids: new Set([id]), anchorId: id };
	}
	const ids = new Set(
		options.preserveHidden
			? selectedIds
			: [...selectedIds].filter((selectedId) =>
					model.visibleIds.has(selectedId),
				),
	);
	if (options.range && anchorId) {
		const rangeIds = selectionRange(model.visibleRows, ids, anchorId, id);
		if (rangeIds) {
			return { ids: rangeIds, anchorId };
		}
	}
	if (options.toggle && ids.delete(id)) {
		return { ids, anchorId: id };
	}
	if (!options.toggle) {
		ids.clear();
	}
	ids.add(id);
	return { ids, anchorId: id };
}

/**
 * `list.selectAll` on a tree: the row's sibling group, widening to include the
 * parent once that whole group is already selected.
 */
function scopedSelection(
	model: TreeModel,
	selectedIds: ReadonlySet<string>,
	row: TreeRowModel,
): Set<string> {
	const scopeId = parentId(row);
	const scoped = model.rows.filter(
		(candidate) => scopeId === undefined || candidate.pathIds.includes(scopeId),
	);
	const ids = new Set(scoped.map((candidate) => candidate.node.id));
	const scope = scopeId ? model.rowsById.get(scopeId) : undefined;
	if (
		scope &&
		scoped.every((candidate) => selectedIds.has(candidate.node.id))
	) {
		ids.add(scope.node.id);
	}
	return ids;
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

/**
 * Prefix first, then a fuzzy subsequence, as the native list does. A repeated
 * single key walks the rows starting with it instead of matching the run.
 */
function typeaheadMatch(
	visibleRows: readonly TreeRowModel[],
	query: string,
	current: TreeRowModel,
): TreeRowModel | undefined {
	const repeated =
		query.length > 1 && [...query].every((key) => key === query[0]);
	const value = (repeated ? query[0] : query)?.toLocaleLowerCase() ?? "";
	const from =
		query.length === 1 || repeated
			? visibleRows.indexOf(current) + 1
			: visibleRows.indexOf(current);
	const ordered = visibleRows.map(
		(_, offset) => visibleRows[(from + offset) % visibleRows.length],
	);
	const fuzzy = (row: TreeRowModel): boolean => {
		let index = 0;
		for (const character of row.textValue.toLocaleLowerCase()) {
			if (character === value[index] && ++index === value.length) {
				return true;
			}
		}
		return false;
	};
	return (
		ordered.find((row) =>
			row?.textValue.toLocaleLowerCase().startsWith(value),
		) ?? ordered.find((row) => row && fuzzy(row))
	);
}

export function transitionTree(
	state: TreeInteractionState,
	commands: readonly TreeCommand[],
	input: TransitionInput,
): TreeTransition {
	const { model } = input;
	const view = deriveTreeInteractionView(state, model, input.controlledIds);
	let nextState = view.state;
	let selectedIds = view.selectedIds;
	let currentKey = view.controlledKey;
	let anchorId = view.anchorId;
	let selection: readonly string[] | undefined;
	let expandedIds: readonly string[] | undefined;
	let focusTree = false;

	const setAnchor = (id: string | undefined): void => {
		anchorId = id;
		nextState = { ...nextState, anchorKey: currentKey, anchorId: id };
	};
	const select = (ids: ReadonlySet<string>, nextAnchor?: string): void => {
		selection = model.rows
			.filter((row) => ids.has(row.node.id))
			.map((row) => row.node.id);
		selectedIds = new Set(selection);
		currentKey = selectionKey(selection);
		nextState = { ...nextState, dismissedSelectionKey: currentKey };
		if (nextAnchor !== undefined) {
			setAnchor(nextAnchor);
		}
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
					const result = selectRow(
						model,
						selectedIds,
						anchorId,
						input.multiSelect,
						row,
						command,
					);
					select(result.ids, result.anchorId);
				}
				break;
			case "selectScope":
				if (row) {
					select(scopedSelection(model, selectedIds, row));
				}
				break;
			case "move": {
				if (!row) {
					break;
				}
				const rows = model.visibleRows;
				const offset = command.page
					? (input.pageOffset ?? command.offset)
					: command.offset;
				const index = rows.indexOf(row) + offset;
				const target = rows[Math.min(Math.max(index, 0), rows.length - 1)];
				if (!target) {
					break;
				}
				if (command.extend) {
					const rangeAnchor = anchorId ?? row.node.id;
					const ids = selectionRange(
						rows,
						selectedIds,
						rangeAnchor,
						target.node.id,
					);
					if (ids) {
						select(ids, rangeAnchor);
					}
				} else {
					setAnchor(target.node.id);
				}
				focus(target);
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
			case "typeahead": {
				if (!row) {
					break;
				}
				const query =
					nextState.typeQuery && input.now < (nextState.typeExpires ?? 0)
						? nextState.typeQuery + command.key
						: command.key;
				nextState = {
					...nextState,
					typeQuery: query,
					typeExpires: input.now + TYPE_QUERY_MS,
				};
				focus(typeaheadMatch(model.visibleRows, query, row));
				break;
			}
			case "dismiss":
				if (command.clearSelection) {
					select(new Set());
				}
				if (command.clearFocus) {
					nextState = { ...nextState, focusTarget: undefined };
					focusTree = true;
				}
				currentKey = NO_SELECTION_KEY;
				setAnchor(undefined);
				break;
		}
	}
	return { state: nextState, selection, expandedIds, focusTree };
}
