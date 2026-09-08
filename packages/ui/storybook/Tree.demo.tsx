import { useState } from "react";

import { Tree, type TreeProps } from "../src/components/Tree/Tree";

import type { TreeNode } from "../src/components/Tree/treeModel";

/** Every branch id, so a demo tree starts fully open unless told otherwise. */
function branchIds(nodes: readonly TreeNode[]): readonly string[] {
	return nodes.flatMap((node) =>
		node.children ? [node.id, ...branchIds(node.children)] : [],
	);
}

/** Holds the selection and expansion state a controlled `Tree` expects. */
export function TreeDemo({
	selectedItemId,
	expandedIds,
	...treeProps
}: Omit<
	TreeProps,
	"onSelectedItemChange" | "onExpandedIdsChange"
>): React.JSX.Element {
	const [selected, setSelected] = useState(selectedItemId);
	const [expanded, setExpanded] = useState(
		() => expandedIds ?? branchIds(treeProps.nodes),
	);

	return (
		<Tree
			{...treeProps}
			selectedItemId={selected}
			onSelectedItemChange={setSelected}
			expandedIds={expanded}
			onExpandedIdsChange={setExpanded}
		/>
	);
}
