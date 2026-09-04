import { useState } from "react";

import { Tree, type TreeProps } from "../src/components/Tree/Tree";

import type { TreeNode } from "../src/components/Tree/treeModel";

const NO_IDS: readonly string[] = [];

/** Every branch id, so a demo tree starts fully open unless told otherwise. */
function branchIds(nodes: readonly TreeNode[]): readonly string[] {
	return nodes.flatMap((node) =>
		node.children ? [node.id, ...branchIds(node.children)] : [],
	);
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
	? Omit<T, Extract<keyof T, K>>
	: never;

export type TreeDemoProps = DistributiveOmit<
	TreeProps,
	"onSelectedItemChange" | "onSelectedItemsChange"
>;

/** Holds the selection and expansion state a controlled `Tree` expects. */
export function TreeDemo({
	multiSelect,
	selectedItemId,
	selectedItemIds,
	expandedIds,
	...treeProps
}: TreeDemoProps): React.JSX.Element {
	const [selectedId, setSelectedId] = useState(selectedItemId);
	const [selectedIds, setSelectedIds] = useState(selectedItemIds ?? NO_IDS);
	const [expanded, setExpanded] = useState(
		() => expandedIds ?? branchIds(treeProps.nodes),
	);
	const selection = multiSelect
		? ({
				multiSelect: true,
				selectedItemIds: selectedIds,
				onSelectedItemsChange: setSelectedIds,
			} as const)
		: ({
				multiSelect: false,
				selectedItemId: selectedId,
				onSelectedItemChange: setSelectedId,
			} as const);

	return (
		<Tree
			{...selection}
			{...treeProps}
			expandedIds={expanded}
			onExpandedIdsChange={setExpanded}
		/>
	);
}
