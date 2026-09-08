import { describe, expect, it } from "vitest";

import { computeStickyState } from "@repo/ui/components/Tree/sticky/stickyState";
import {
	createTreeModel,
	ROW_HEIGHT_PX,
	type TreeNode,
} from "@repo/ui/components/Tree/treeModel";
const leaves = (prefix: string, count: number): TreeNode[] =>
	Array.from({ length: count }, (_, index) => ({
		id: `${prefix}/${index}`,
		label: `${prefix}/${index}`,
	}));
// Row indices: 0 a, 1-3 a/*, 4 b, 5-7 b/*, 8 c, 9-13 c/*, 14 z.
const ROWS = createTreeModel(
	[
		{
			id: "a",
			label: "a",
			children: [
				...leaves("a", 3),
				{
					id: "b",
					label: "b",
					children: [
						...leaves("b", 3),
						{ id: "c", label: "c", children: leaves("c", 5) },
					],
				},
			],
		},
		{ id: "z", label: "z" },
	],
	new Set(["a", "b", "c"]),
).visibleRows;
const px = (rows: number): number => rows * ROW_HEIGHT_PX;
const VIEWPORT = px(10);
describe("computeStickyState", () => {
	it.each([
		["before scrolling", 0, VIEWPORT, 7, []],
		["without a viewport", px(2), 0, 7, []],
		["in the first subtree", px(1), VIEWPORT, 7, ["a"]],
		["at the deepest subtree", px(9), VIEWPORT, 7, ["a", "b", "c"]],
		["at the item cap", px(9), VIEWPORT, 2, ["a", "b"]],
		["at 40% of the viewport", px(9), px(1.5) / 0.4, 7, ["a"]],
		["past every branch", px(14), VIEWPORT, 7, []],
	] as const)(
		"pins the expected chain %s",
		(_case, scrollTop, height, cap, ids) => {
			expect(computeStickyState(ROWS, scrollTop, height, cap).ids).toEqual(ids);
		},
	);
	it("pushes the widget out as the last pinned subtree ends", () => {
		const state = computeStickyState(ROWS, px(12), VIEWPORT, 7);
		expect(state.ids).toEqual(["a", "b", "c"]);
		expect(state.pushOffset).toBe(px(14) - (px(12) + px(3)));
	});
});
