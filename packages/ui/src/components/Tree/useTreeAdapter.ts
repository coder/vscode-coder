import {
	type KeyboardEvent,
	type MouseEvent,
	useMemo,
	useRef,
	useState,
} from "react";

import {
	closestRow,
	hitTwistie,
	nestedInteractiveTarget,
	scrollableAncestor,
} from "./rowDom";
import {
	createTreeModel,
	ROW_HEIGHT_PX,
	rowTooltip,
	type TreeNode,
	type TreeRowModel,
} from "./treeModel";
import {
	isSelectionGesture,
	keyboardCommands,
	pointerCommands,
	type TreeCommand,
	type TreeCommandBehavior,
	type TreeExpandMode,
	type TreeMultiSelectModifier,
} from "./treePolicy";
import {
	deriveTreeInteractionView,
	initialTreeInteractionState,
	rowFocused,
	transitionTree,
	treeFocusChanged,
	type TreeInteractionState,
} from "./treeTransition";

import type { TreeHoverControl } from "./TreeHover";

const NO_IDS: readonly string[] = [];
const NO_GUIDES = "";
const MODIFIER_KEYS: ReadonlySet<string> = new Set([
	"Alt",
	"Control",
	"Meta",
	"Shift",
]);

/** Single selection, or multi-selection, never a mix of the two APIs. */
export type SelectionProps =
	| {
			readonly multiSelect?: false;
			readonly selectedItemId?: string;
			readonly onSelectedItemChange?: (itemId: string | undefined) => void;
			readonly selectedItemIds?: never;
			readonly onSelectedItemsChange?: never;
	  }
	| {
			readonly multiSelect: true;
			readonly selectedItemIds?: readonly string[];
			readonly onSelectedItemsChange?: (itemIds: readonly string[]) => void;
			readonly selectedItemId?: never;
			readonly onSelectedItemChange?: never;
	  };

interface AdapterOptions {
	readonly nodes: readonly TreeNode[];
	readonly expandedIds: readonly string[];
	readonly onExpandedIdsChange?: (expandedIds: readonly string[]) => void;
	readonly expandMode: TreeExpandMode;
	readonly multiSelectModifier: TreeMultiSelectModifier;
	readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	readonly treeRef: React.RefObject<HTMLDivElement | null>;
	readonly hoverControl?: TreeHoverControl;
}

function rowElement(tree: HTMLElement | null, id: string): HTMLElement | null {
	return (
		tree?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`) ??
		null
	);
}

function controlledIds(selection: SelectionProps): readonly string[] {
	if (selection.multiSelect) {
		return selection.selectedItemIds ?? NO_IDS;
	}
	return selection.selectedItemId === undefined
		? NO_IDS
		: [selection.selectedItemId];
}

/**
 * Where the pure modules meet React and the DOM. Events arrive delegated from
 * the container, which leaves rows as memoized presentation.
 */
export function useTreeAdapter(options: AdapterOptions & SelectionProps) {
	const { nodes, expandedIds, treeRef } = options;
	// Explicit: memoized rows compare against these row objects, and a consumer
	// of the published package may not run the React Compiler.
	const model = useMemo(
		() => createTreeModel(nodes, new Set(expandedIds)),
		[nodes, expandedIds],
	);
	const { visibleRows, rowsById } = model;
	const selected = controlledIds(options);
	const chordRef = useRef(false);
	const [state, setState] = useState<TreeInteractionState>(() =>
		initialTreeInteractionState(selected),
	);
	const view = deriveTreeInteractionView(state, model, selected);
	// Identity, not value: the view returns this same state unless the data
	// moved, and then the reconciled one renders instead.
	if (view.state !== state) {
		setState(view.state);
	}
	const behavior: TreeCommandBehavior = {
		expandMode: options.expandMode,
		multiSelect: Boolean(options.multiSelect),
		multiSelectModifier: options.multiSelectModifier,
	};

	/**
	 * How far a page key travels: to the far edge of the viewport, or a whole
	 * viewport once the focused row is already sitting on it.
	 */
	const pageOffset = (row: TreeRowModel, direction: 1 | -1): number => {
		const tree = treeRef.current;
		const scroller = tree ? scrollableAncestor(tree) : undefined;
		if (!tree || !scroller) {
			return direction;
		}
		const viewport = scroller.getBoundingClientRect();
		if (viewport.height > 0) {
			const inView = [
				...tree.querySelectorAll<HTMLElement>("[data-tree-id]"),
			].filter((element) => {
				const bounds = element.getBoundingClientRect();
				return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
			});
			const edge = direction === 1 ? inView.at(-1) : inView[0];
			const edgeId = edge?.dataset.treeId;
			const edgeRow = edgeId ? rowsById.get(edgeId) : undefined;
			const offset = edgeRow
				? visibleRows.indexOf(edgeRow) - visibleRows.indexOf(row)
				: 0;
			if (offset !== 0) {
				return offset;
			}
			scroller.scrollBy?.(0, direction * scroller.clientHeight);
		}
		return (
			direction * Math.max(1, Math.floor(scroller.clientHeight / ROW_HEIGHT_PX))
		);
	};

	const dispatch = (commands: readonly TreeCommand[]): void => {
		const move = commands.find((command) => command.type === "move");
		const moved = move ? rowsById.get(move.id) : undefined;
		const result = transitionTree(state, commands, {
			model,
			controlledIds: selected,
			expandedIds,
			multiSelect: behavior.multiSelect,
			pageOffset:
				move?.page && moved ? pageOffset(moved, move.offset) : undefined,
			now: Date.now(),
		});
		setState(result.state);
		if (result.selection) {
			if (options.multiSelect) {
				options.onSelectedItemsChange?.(result.selection);
			} else {
				options.onSelectedItemChange?.(result.selection[0]);
			}
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
		// Only an entry with no focus target adopts a row: a focus mark the same
		// gesture just cleared must not come back when focus returns here.
		const entered = view.state.focusTarget
			? undefined
			: (row ?? rowsById.get(view.tabStopId ?? ""));
		setState((current) => treeFocusChanged(current, true, entered));
	};
	const onPointer = (
		row: TreeRowModel,
		event: MouseEvent,
		onTwistie: boolean,
		source: "row" | "sticky",
	): void => {
		dispatch(
			pointerCommands({
				...behavior,
				row,
				source,
				onTwistie,
				detail: event.detail,
				modifiers: event,
			}),
		);
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
		onPointer(row, event, hitTwistie(row, event.target), "row");
	};
	/** VS Code binds `list.showHover` to the Ctrl+K Ctrl+I chord. */
	const showHoverChord = (
		event: KeyboardEvent<HTMLDivElement>,
	): "pending" | "show" | undefined => {
		const held = (event.ctrlKey || event.metaKey) && !event.altKey;
		const key = held ? event.key.toLowerCase() : "";
		const armed = chordRef.current;
		chordRef.current = !armed && key === "k";
		if (chordRef.current) {
			return "pending";
		}
		return armed && key === "i" ? "show" : undefined;
	};
	const showHover = (row: TreeRowModel | undefined): void => {
		const element = row
			? rowElement(treeRef.current, row.node.id)?.querySelector<HTMLElement>(
					".ui-tree-item__content",
				)
			: undefined;
		options.hoverControl?.current?.(
			row && element ? { content: rowTooltip(row), element } : undefined,
			true,
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
		// A hover the keyboard opened stays only until the next real key.
		if (!MODIFIER_KEYS.has(event.key)) {
			const chord = showHoverChord(event);
			if (chord) {
				if (chord === "show") {
					showHover(row);
				}
				event.preventDefault();
				return;
			}
			showHover(undefined);
		}
		const interactive = nestedInteractiveTarget(
			event.target,
			event.currentTarget,
		);
		const result = keyboardCommands({
			...behavior,
			key: event.key,
			row,
			visibleRows,
			fromAction:
				interactive instanceof HTMLElement &&
				interactive.dataset.treeId === undefined,
			selectedCount: view.selectedIds.size,
			hasFocusedRow: view.focusedId !== undefined,
			modifiers: event,
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
		isSelectionGesture: (event: MouseEvent) =>
			isSelectionGesture(event, behavior),
		onFocusIn,
		onBlurOut: () => {
			showHover(undefined);
			setState((current) => treeFocusChanged(current, false));
		},
		onClick,
		onPointer,
		onKeyDown,
	};
}

export type TreeAdapter = ReturnType<typeof useTreeAdapter>;
