import { type ComponentPropsWithRef, useId, useRef } from "react";

import { cx } from "#cx";
import { setForwardedRef } from "#ref";

import { TooltipScope } from "../Tooltip/Tooltip";

import { StickyScroll } from "./sticky/StickyScroll";
import "./Tree.css";
import { TreeHover, type TreeHoverControl } from "./TreeHover";
import { TreeRow } from "./TreeRow";
import { useTreeAdapter, type SelectionProps } from "./useTreeAdapter";

import type { TreeNode } from "./treeModel";
import type { TreeExpandMode, TreeMultiSelectModifier } from "./treePolicy";

/** VS Code's `workbench.tree.stickyScrollMaxItemCount` default. */
const DEFAULT_STICKY_COUNT = 7;
const NO_IDS: readonly string[] = [];

/** The tree's own props; everything else lands on the container element. */
interface TreeOwnProps {
	readonly nodes: readonly TreeNode[];
	readonly expandedIds?: readonly string[];
	readonly onExpandedIdsChange?: (expandedIds: readonly string[]) => void;
	/** `explorer` aligns leaf icons with branch twisties, as VS Code does. */
	readonly variant?: "default" | "explorer";
	readonly expandMode?: TreeExpandMode;
	readonly multiSelectModifier?: TreeMultiSelectModifier;
	/** Pins ancestors while scrolling; a number caps how many. */
	readonly stickyScroll?: boolean | number;
}

type TreeContainerProps = Omit<
	ComponentPropsWithRef<"div">,
	"role" | "onSelect" | "children" | keyof TreeOwnProps
>;

export type TreeProps = TreeOwnProps & SelectionProps & TreeContainerProps;

/** Whether the focus or blur target is inside the tree rather than a portal. */
function ownsTarget(tree: HTMLElement, target: EventTarget | null): boolean {
	return target instanceof Node && tree.contains(target);
}

/** A controlled tree following the current VS Code workbench behavior. */
export function Tree({
	nodes,
	expandedIds = NO_IDS,
	onExpandedIdsChange,
	multiSelect,
	selectedItemId,
	onSelectedItemChange,
	selectedItemIds,
	onSelectedItemsChange,
	variant = "default",
	expandMode = "singleClick",
	multiSelectModifier = "ctrlCmd",
	stickyScroll = false,
	className,
	onFocus,
	onBlur,
	onKeyDown,
	ref,
	...containerProps
}: TreeProps): React.JSX.Element {
	const treeRef = useRef<HTMLDivElement>(null);
	const hoverRef: TreeHoverControl = useRef(undefined);
	const treeDomId = useId();
	const selection: SelectionProps = multiSelect
		? { multiSelect: true, selectedItemIds, onSelectedItemsChange }
		: { multiSelect: false, selectedItemId, onSelectedItemChange };
	const adapter = useTreeAdapter({
		...selection,
		nodes,
		expandedIds,
		onExpandedIdsChange,
		expandMode,
		multiSelectModifier,
		onKeyDown,
		treeRef,
		hoverControl: hoverRef,
	});

	return (
		<TooltipScope>
			<div
				{...containerProps}
				ref={(element) => {
					treeRef.current = element;
					setForwardedRef(ref, element);
				}}
				role="tree"
				tabIndex={0}
				aria-activedescendant={
					adapter.focusedId ? `${treeDomId}-${adapter.focusedId}` : undefined
				}
				aria-multiselectable={multiSelect ? true : undefined}
				className={cx(
					"ui-tree",
					variant === "explorer" && "ui-tree--explorer",
					adapter.hasDomFocus && "ui-tree--focused",
					className,
				)}
				onFocus={(event) => {
					onFocus?.(event);
					if (
						!event.defaultPrevented &&
						ownsTarget(event.currentTarget, event.target)
					) {
						adapter.onFocusIn(event.target);
					}
				}}
				onBlur={(event) => {
					onBlur?.(event);
					if (
						!event.defaultPrevented &&
						!ownsTarget(event.currentTarget, event.relatedTarget)
					) {
						adapter.onBlurOut();
					}
				}}
				onClick={adapter.onClick}
				onKeyDown={adapter.onKeyDown}
			>
				<TreeHover treeRef={treeRef} controlRef={hoverRef}>
					{stickyScroll ? (
						<StickyScroll
							maxCount={
								stickyScroll === true ? DEFAULT_STICKY_COUNT : stickyScroll
							}
							adapter={adapter}
							treeRef={treeRef}
						/>
					) : null}
					{adapter.model.visibleRows.map((row) => (
						<TreeRow
							key={row.node.id}
							id={`${treeDomId}-${row.node.id}`}
							row={row}
							focused={row.node.id === adapter.focusedId}
							selected={adapter.selectedIds.has(row.node.id)}
							guideFlags={adapter.guideFlags(row)}
						/>
					))}
				</TreeHover>
			</div>
		</TooltipScope>
	);
}
