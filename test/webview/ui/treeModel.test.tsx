import { describe, expect, it } from "vitest";

import {
	createTreeModel,
	parentId,
	type TreeNode,
	type TreeRowModel,
} from "@repo/ui/components/Tree/treeModel";

const NODES: readonly TreeNode[] = [
	{
		id: "src",
		label: "src",
		children: [
			{ id: "tree", label: <em>Tree.tsx</em>, textValue: "Tree.tsx" },
			{
				id: "tests",
				label: "tests",
				children: [{ id: "unit", label: "unit" }],
			},
		],
	},
	{ id: "readme", label: "README.md" },
];

const model = (...expandedIds: string[]) =>
	createTreeModel(NODES, new Set(expandedIds));
const ids = (rows: readonly TreeRowModel[]): string[] =>
	rows.map((row) => row.node.id);
const rowOf = (id: string): TreeRowModel => {
	const row = model("src", "tests").rowsById.get(id);
	if (!row) throw new Error(`Expected row ${id}.`);
	return row;
};

describe("createTreeModel", () => {
	it.each([
		[[], ["src", "readme"]],
		[["src"], ["src", "tree", "tests", "readme"]],
		[
			["src", "tests"],
			["src", "tree", "tests", "unit", "readme"],
		],
	] as const)(
		"projects expanded subtrees %j in tree order",
		(expanded, rows) => {
			expect(ids(model(...expanded).visibleRows)).toEqual(rows);
		},
	);

	it("keeps hidden rows addressable while only visible ones are projected", () => {
		const collapsed = model();
		expect(ids(collapsed.rows)).toEqual([
			"src",
			"tree",
			"tests",
			"unit",
			"readme",
		]);
		expect([...collapsed.visibleIds]).toEqual(["src", "readme"]);
		expect(collapsed.rowsById.get("unit")?.textValue).toBe("unit");
	});

	it("derives row metadata from hierarchy, labels, and expansion", () => {
		expect(rowOf("src")).toMatchObject({
			pathIds: [],
			posInSet: 1,
			setSize: 2,
			textValue: "src",
			expanded: true,
		});
		expect(rowOf("unit")).toMatchObject({
			pathIds: ["src", "tests"],
			posInSet: 1,
			setSize: 1,
			expanded: undefined,
		});
		expect(rowOf("readme")).toMatchObject({ posInSet: 2, setSize: 2 });
		// A rich label carries its own text value.
		expect(rowOf("tree").textValue).toBe("Tree.tsx");
		expect(parentId(rowOf("unit"))).toBe("tests");
		expect(parentId(rowOf("src"))).toBeUndefined();
	});

	it.each([
		[
			"siblings",
			[
				{ id: "dup", label: "One" },
				{ id: "dup", label: "Two" },
			],
		],
		[
			"a collapsed branch",
			[
				{
					id: "collapsed",
					label: "Collapsed",
					children: [
						{ id: "dup", label: "One" },
						{ id: "dup", label: "Two" },
					],
				},
			],
		],
	] satisfies ReadonlyArray<readonly [string, readonly TreeNode[]]>)(
		"rejects an id reused by %s",
		(_case, nodes) => {
			expect(() => createTreeModel(nodes, new Set())).toThrow(
				/must be unique/i,
			);
		},
	);
});
