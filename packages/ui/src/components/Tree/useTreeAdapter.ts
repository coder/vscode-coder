import { type KeyboardEvent, type MouseEvent, useMemo, useState } from "react";

import { closestRow, nestedInteractiveTarget } from "./rowDom";
import { createTreeModel, type TreeNode, type TreeRowModel } from "./treeModel";
import {
	keyboardCommands,
	pointerCommands,
	type TreeCommand,
	type TreeExpandMode,
} from "./treePolicy";
import {
	deriveTreeInteractionView,
	initialTreeInteractionState,
	rowFocused,
	transitionTree,
	treeFocusChanged,
	type TreeInteractionState,
} from "./treeTransition";

const NO_IDS: readonly string[] = [];
const NO_GUIDES = "";

export interface SelectionProps {
	readonly selectedItemId?: string;
	readonly onSelectedItemChange?: (itemId: string | undefined) => void;
}

interface AdapterOptions extends SelectionProps {
	readonly nodes: readonly TreeNode[];
	readonly expandedIds: readonly string[];
	readonly onExpandedIdsChange?: (expandedIds: readonly string[]) => void;
	readonly expandMode: TreeExpandMode;
	readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	readonly treeRef: React.RefObject<HTMLDivElement | null>;
}

function rowElement(tree: HTMLElement | null, id: string): HTMLElement | null {
	return (
		tree?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`) ??
		null
	);
}

function hitTwistie(row: TreeRowModel, target: EventTarget): boolean {
	return (
		row.expanded !== undefined &&
		target instanceof Element &&
		target.closest(".ui-tree-item__chevron") !== null
	);
}

/**
 * Where the pure modules meet React and the DOM. Events arrive delegated from
 * the container, which leaves rows as memoized presentation.
 */
export function useTreeAdapter(options: AdapterOptions) {
	const { nodes, expandedIds, expandMode, treeRef } = options;
	// Explicit: memoized rows compare against these row objects, and a consumer
	// of the published package may not run the React Compiler.
	const model = useMemo(
		() => createTreeModel(nodes, new Set(expandedIds)),
		[nodes, expandedIds],
	);
	const { visibleRows, rowsById } = model;
	const selectedItemIds =
		options.selectedItemId === undefined ? NO_IDS : [options.selectedItemId];
	const [state, setState] = useState<TreeInteractionState>(
		initialTreeInteractionState,
	);
	const view = deriveTreeInteractionView(state, model, selectedItemIds);
	// Identity, not value: the view returns this same state unless the data
	// moved, and then the reconciled one renders instead.
	if (view.state !== state) {
		setState(view.state);
	}

	const dispatch = (commands: readonly TreeCommand[]): void => {
		const result = transitionTree(state, commands, {
			model,
			controlledIds: selectedItemIds,
			expandedIds,
		});
		setState(result.state);
		if (result.selection) {
			options.onSelectedItemChange?.(result.selection[0]);
		}
		if (result.expandedIds) {
			options.onExpandedIdsChange?.(result.expandedIds);
		}
		if (result.focusTree) {
			treeRef.current?.focus();
		}
	};

	const rowFor = (target: EventTarget | null): TreeRowModel | undefined => {
		const id = closestRow(target)?.dataset.treeId;
		return id ? rowsById.get(id) : undefined;
	};
	const onFocusIn = (target: EventTarget | null): void => {
		const row = rowFor(target);
		// A row focused in its own right becomes the focus target; entering the
		// container only adopts one.
		if (row && target === closestRow(target)) {
			setState((current) => rowFocused(current, row, view.controlledKey));
		}
		const entered = row ?? rowsById.get(view.tabStopId ?? "");
		setState((current) => treeFocusChanged(current, true, entered));
	};
	const onClick = (event: MouseEvent<HTMLDivElement>): void => {
		const element = closestRow(event.target);
		const row = rowFor(event.target);
		if (!row || !element) {
			return;
		}
		// Focusable content and the action bar handle their own clicks.
		if (
			nestedInteractiveTarget(event.target, element) ||
			(event.target instanceof Element &&
				event.target.closest(".ui-tree-item__action"))
		) {
			return;
		}
		dispatch(
			pointerCommands({
				expandMode,
				row,
				onTwistie: hitTwistie(row, event.target),
				detail: event.detail,
				altKey: event.altKey,
			}),
		);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		options.onKeyDown?.(event);
		if (event.defaultPrevented) {
			return;
		}
		const row =
			rowFor(event.target) ??
			(view.focusedId ? rowsById.get(view.focusedId) : undefined) ??
			(view.tabStopId ? rowsById.get(view.tabStopId) : undefined) ??
			visibleRows[0];
		if (!row) {
			return;
		}
		const interactive = nestedInteractiveTarget(
			event.target,
			event.currentTarget,
		);
		const result = keyboardCommands({
			expandMode,
			key: event.key,
			row,
			visibleRows,
			fromAction:
				interactive instanceof HTMLElement &&
				interactive.dataset.treeId === undefined,
			selectedCount: view.selectedIds.size,
			hasFocusedRow: view.focusedId !== undefined,
		});
		if (result.focusRowElementId) {
			rowElement(treeRef.current, result.focusRowElementId)?.focus();
		}
		dispatch(result.commands);
		if (result.preventDefault) {
			event.preventDefault();
		}
	};

	return {
		model,
		focusedId: view.focusedId,
		tabStopId: view.tabStopId,
		hasDomFocus: view.state.hasDomFocus,
		selectedIds: view.selectedIds,
		/** One character per ancestor, `1` where its guide is active. */
		guideFlags: (row: TreeRowModel): string =>
			view.guideOwnerIds.size === 0
				? NO_GUIDES
				: row.pathIds
						.map((id) => (view.guideOwnerIds.has(id) ? "1" : "0"))
						.join(""),
		dispatch,
		onFocusIn,
		onBlurOut: () => setState((current) => treeFocusChanged(current, false)),
		onClick,
		onKeyDown,
	};
}
