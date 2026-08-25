import {
	type RefObject,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { hitTwistie, scrollableAncestor } from "../rowDom";
import { ROW_HEIGHT_PX, type TreeRowModel } from "../treeModel";
import { TreeRow } from "../TreeRow";

import { computeStickyState, NO_STICKY, type StickyState } from "./stickyState";

import type { TreeAdapter } from "../useTreeAdapter";

function useStickyState(
	rows: readonly TreeRowModel[],
	maxCount: number,
	widgetRef: RefObject<HTMLDivElement | null>,
): StickyState {
	const snapshotRef = useRef(NO_STICKY);
	const subscribe = (notify: () => void): (() => void) => {
		const tree = widgetRef.current?.parentElement;
		const scroller = tree ? scrollableAncestor(tree) : undefined;
		if (!scroller) return () => undefined;
		scroller.addEventListener("scroll", notify, { passive: true });
		const observer =
			typeof ResizeObserver === "undefined"
				? undefined
				: new ResizeObserver(notify);
		observer?.observe(scroller);
		return () => {
			scroller.removeEventListener("scroll", notify);
			observer?.disconnect();
		};
	};
	const getSnapshot = (): StickyState => {
		const widget = widgetRef.current;
		const tree = widget?.parentElement;
		if (!widget || !tree) return NO_STICKY;
		const next = computeStickyState(
			rows,
			widget.getBoundingClientRect().top - tree.getBoundingClientRect().top,
			scrollableAncestor(tree)?.clientHeight ?? 0,
			maxCount,
		);
		const current = snapshotRef.current;
		if (
			current.pushOffset !== next.pushOffset ||
			current.ids.length !== next.ids.length ||
			current.ids.some((id, index) => id !== next.ids[index])
		)
			snapshotRef.current = next;
		return snapshotRef.current;
	};
	return useSyncExternalStore(subscribe, getSnapshot, () => NO_STICKY);
}

export function StickyScroll({
	maxCount,
	adapter,
	treeRef,
}: {
	maxCount: number;
	adapter: TreeAdapter;
	treeRef: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
	const { visibleRows, rowsById } = adapter.model;
	const widgetRef = useRef<HTMLDivElement>(null);
	const state = useStickyState(visibleRows, maxCount, widgetRef);
	const pinnedRows = state.ids
		.map((id) => rowsById.get(id))
		.filter((row) => row !== undefined);
	const pinnedHeight = pinnedRows.length * ROW_HEIGHT_PX + state.pushOffset;
	const [requestedIndex, setRequestedIndex] = useState(0);
	const focusedIndex = Math.max(
		0,
		Math.min(requestedIndex, pinnedRows.length - 1),
	);

	useEffect(() => {
		if (
			pinnedRows.length === 0 &&
			widgetRef.current?.contains(document.activeElement)
		) {
			treeRef.current?.focus();
		}
	}, [pinnedRows.length, treeRef]);

	const reveal = (row: TreeRowModel, index: number): void => {
		const widget = widgetRef.current;
		const tree = widget?.parentElement;
		if (!widget || !tree) return;
		scrollableAncestor(tree)?.scrollBy(
			0,
			visibleRows.indexOf(row) * ROW_HEIGHT_PX -
				index * ROW_HEIGHT_PX -
				(widget.getBoundingClientRect().top - tree.getBoundingClientRect().top),
		);
	};
	const revealAndDispatch = (
		row: TreeRowModel,
		commands: Parameters<TreeAdapter["dispatch"]>[0],
	): void => {
		reveal(row, focusedIndex);
		adapter.dispatch(commands);
	};

	return (
		<div
			className="ui-tree-sticky"
			ref={widgetRef}
			tabIndex={pinnedRows.length > 0 ? 0 : -1}
			onFocus={(event) => {
				if (event.target === event.currentTarget)
					setRequestedIndex(focusedIndex);
			}}
			onKeyDown={(event) => {
				const row = pinnedRows[focusedIndex];
				if (!row) return;
				if (event.key === "ArrowUp")
					setRequestedIndex(Math.max(0, focusedIndex - 1));
				else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
					if (pinnedRows[focusedIndex + 1]) setRequestedIndex(focusedIndex + 1);
					else {
						const child = visibleRows[visibleRows.indexOf(row) + 1];
						if (child?.pathIds.includes(row.node.id)) {
							adapter.dispatch([{ type: "focus", id: child.node.id }]);
						}
					}
				} else if (event.key === "Enter") {
					revealAndDispatch(row, [
						{ type: "focus", id: row.node.id },
						{
							type: "select",
							id: row.node.id,
							toggle: false,
							range: false,
							preserveHidden: true,
						},
					]);
				} else if (event.key === "ArrowLeft") {
					revealAndDispatch(row, [
						{ type: "focus", id: row.node.id },
						...(row.expanded
							? [
									{
										type: "toggle" as const,
										id: row.node.id,
										recursive: false,
									},
								]
							: []),
					]);
				} else if (event.key === " ") {
					revealAndDispatch(row, [{ type: "focus", id: row.node.id }]);
				} else return;
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{pinnedRows.length > 0 ? (
				<>
					<div
						className="ui-tree-sticky__rows"
						style={{ height: pinnedHeight }}
						onClick={(event) => {
							const index = [...event.currentTarget.children].findIndex(
								(child) => child.contains(event.target as Node),
							);
							const row = pinnedRows[index];
							if (!row) return;
							if (!adapter.isSelectionGesture(event)) reveal(row, index);
							adapter.onPointer(
								row,
								event,
								hitTwistie(row, event.target),
								"sticky",
							);
						}}
					>
						{pinnedRows.map((row, index) => (
							<TreeRow
								key={row.node.id}
								row={row}
								focused={index === focusedIndex}
								style={{
									top:
										index * ROW_HEIGHT_PX +
										(index === pinnedRows.length - 1 ? state.pushOffset : 0),
									zIndex: pinnedRows.length - index,
								}}
							/>
						))}
					</div>
					<div
						className="ui-tree-sticky__shadow"
						style={{ top: pinnedHeight }}
					/>
				</>
			) : null}
		</div>
	);
}
