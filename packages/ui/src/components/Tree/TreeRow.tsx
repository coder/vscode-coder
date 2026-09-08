import { type CSSProperties, memo } from "react";

import { cx } from "#cx";

import { Icon } from "../Icon/Icon";

import type { TreeRowModel } from "./treeModel";

interface TreeRowProps {
	readonly row: TreeRowModel;
	/** Left out by rows rendered outside the tree, which only present. */
	readonly id?: string;
	readonly focused?: boolean;
	readonly selected?: boolean;
	/** One character per ancestor, `1` where the indent guide is active. */
	readonly guideFlags?: string;
	/** Positions a pinned copy inside the sticky widget. */
	readonly style?: CSSProperties;
}

/** Pure presentation: props compare by value, so `memo` skips untouched rows. */
export const TreeRow = memo(function TreeRow({
	row,
	id,
	focused = false,
	selected = false,
	guideFlags = "",
	style,
}: TreeRowProps): React.JSX.Element {
	const { node, expanded } = row;
	const level = row.pathIds.length + 1;
	return (
		<div
			id={id}
			data-tree-id={id ? node.id : undefined}
			role="treeitem"
			aria-label={row.textValue === "" ? undefined : row.textValue}
			aria-level={level}
			aria-posinset={row.posInSet}
			aria-setsize={row.setSize}
			aria-selected={selected}
			aria-expanded={expanded}
			tabIndex={-1}
			className={cx(
				"ui-tree-item",
				focused && "ui-tree-item--focused",
				node.className,
			)}
			style={{ ...style, "--ui-tree-level": level } as CSSProperties}
		>
			<div className="ui-tree-item__row">
				<span className="ui-tree-item__indent" aria-hidden="true">
					{row.pathIds.map((pathId, depth) => (
						<span
							key={pathId}
							className={cx(
								"ui-tree-item__indent-slot",
								guideFlags[depth] === "1" &&
									"ui-tree-item__indent-slot--active",
							)}
						/>
					))}
				</span>
				<span className="ui-tree-item__chevron" aria-hidden="true">
					{expanded === undefined ? null : (
						<Icon name={expanded ? "chevron-down" : "chevron-right"} />
					)}
				</span>
				<span className="ui-tree-item__content">
					{node.icon ? <Icon name={node.icon} /> : null}
					{typeof node.label === "string" ? (
						<span>{node.label}</span>
					) : (
						node.label
					)}
				</span>
				{/* Native keeps a row's actions live on plain hover; CSS reveals them. */}
				{node.action ? (
					<span className="ui-tree-item__action">{node.action}</span>
				) : null}
			</div>
		</div>
	);
});
