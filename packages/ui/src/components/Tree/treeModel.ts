import type { ReactNode } from "react";

import type { CodiconName } from "#codicons";

/** VS Code's tree row height; Tree.css --ui-tree-row-height must match. */
export const ROW_HEIGHT_PX = 22;

/** A string label doubles as the text value; a rich label must supply one. */
type TreeNodeLabel =
	| { readonly label: string; readonly textValue?: string }
	| { readonly label: ReactNode; readonly textValue: string };

/** One node of tree data. `children` marks a branch, `[]` one still loading. */
export type TreeNode = TreeNodeLabel & {
	readonly id: string;
	readonly icon?: CodiconName;
	readonly action?: ReactNode;
	readonly className?: string;
	readonly children?: readonly TreeNode[];
};

export interface TreeRowModel {
	readonly node: TreeNode;
	/** Ancestor ids, outermost first; the ARIA level is one past its length. */
	readonly pathIds: readonly string[];
	/** Flat rows have no group element, so each declares its own set. */
	readonly posInSet: number;
	readonly setSize: number;
	readonly textValue: string;
	/** undefined on leaves. */
	readonly expanded: boolean | undefined;
}

export interface TreeModel {
	/** Rows under expanded ancestors only, in render order. */
	readonly visibleRows: readonly TreeRowModel[];
	/** Every row, hidden ones included. */
	readonly rows: readonly TreeRowModel[];
	readonly rowsById: ReadonlyMap<string, TreeRowModel>;
	readonly visibleIds: ReadonlySet<string>;
}

export function parentId(row: TreeRowModel): string | undefined {
	return row.pathIds.at(-1);
}

/** Ids are unique tree wide, as in VS Code, so a duplicate throws. */
export function createTreeModel(
	nodes: readonly TreeNode[],
	expandedIds: ReadonlySet<string>,
): TreeModel {
	const visibleRows: TreeRowModel[] = [];
	const rows: TreeRowModel[] = [];
	const rowsById = new Map<string, TreeRowModel>();

	const visit = (
		siblings: readonly TreeNode[],
		pathIds: readonly string[],
		visible: boolean,
	): void => {
		siblings.forEach((node, index) => {
			if (rowsById.has(node.id)) {
				throw new Error(`Tree node id "${node.id}" must be unique.`);
			}
			const expanded = node.children ? expandedIds.has(node.id) : undefined;
			const row: TreeRowModel = {
				node,
				pathIds,
				posInSet: index + 1,
				setSize: siblings.length,
				textValue:
					node.textValue ?? (typeof node.label === "string" ? node.label : ""),
				expanded,
			};
			rows.push(row);
			rowsById.set(node.id, row);
			if (visible) {
				visibleRows.push(row);
			}
			if (node.children) {
				visit(
					node.children,
					[...pathIds, node.id],
					visible && expanded === true,
				);
			}
		});
	};

	visit(nodes, [], true);
	return {
		visibleRows,
		rows,
		rowsById,
		visibleIds: new Set(visibleRows.map((row) => row.node.id)),
	};
}
