import {
	expect,
	fireEvent,
	screen,
	userEvent,
	waitFor,
	within,
} from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import { TreeDemo } from "../../../storybook/Tree.demo";
import { IconButton } from "../IconButton/IconButton";

import type { Meta, StoryObj } from "@storybook/react-vite";

import type { CodiconName } from "#codicons";

import type { TreeProps } from "./Tree";
import type { TreeNode } from "./treeModel";

interface NodeOptions {
	readonly label?: string;
	readonly icon?: CodiconName;
	readonly action?: React.ReactNode;
	readonly className?: string;
}
const node = (id: string, options: NodeOptions = {}): TreeNode => ({
	id,
	label: id,
	...options,
});
const branch = (
	id: string,
	children: readonly TreeNode[],
	options: NodeOptions = {},
): TreeNode => ({ ...node(id, options), children });
const closeAction = (name: string): React.ReactNode => (
	<IconButton icon="close" label={`Close ${name}`} />
);

/** Branch rows have no icons, so explorer aligns leaf icons with twisties. */
const FILES: readonly TreeNode[] = [
	branch(
		"source",
		[
			branch("components", [
				node("tree", {
					label: "Tree.tsx",
					icon: "symbol-class",
					action: closeAction("Tree.tsx"),
				}),
				node("styles", { label: "Tree.css", icon: "symbol-color" }),
			]),
			node("tests", { icon: "beaker" }),
		],
		{ label: "src" },
	),
	node("readme", { label: "README.md", icon: "markdown" }),
];

const tree = (props: TreeProps): React.JSX.Element => (
	<TreeDemo style={{ width: "280px" }} {...props} />
);
const TreeStates = (): React.JSX.Element =>
	tree({
		"aria-label": "Explorer",
		nodes: FILES,
		selectedItemId: "components",
		variant: "explorer",
	});
const meta: Meta<typeof TreeStates> = {
	title: "UI/Tree",
	component: TreeStates,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof TreeStates>;

const exerciseTree: NonNullable<Story["play"]> = async ({ canvasElement }) => {
	const canvas = within(canvasElement);
	const selected = canvas.getByRole("treeitem", { name: "components" });
	const treeItem = canvas.getByRole("treeitem", { name: "Tree.tsx" });
	await expect(selected).toHaveAttribute("aria-selected", "true");
	await userEvent.click(
		canvas.getByRole("button", { name: "Close Tree.tsx", hidden: true }),
	);
	await expect(selected).toHaveAttribute("aria-selected", "true");
	await expect(treeItem).toHaveAttribute("aria-selected", "false");
	await userEvent.click(treeItem);
	await expect(treeItem).toHaveAttribute("aria-selected", "true");
	const readme = canvas.getByRole("treeitem", { name: "README.md" });
	await userEvent.click(readme);
	await expect(readme).toHaveAttribute("aria-selected", "true");
};

export const States: Story = { play: exerciseTree };
export const Stable: Story = {
	globals: { uiStyle: "stable" },
	play: exerciseTree,
};

const ROW_STATES: readonly TreeNode[] = [
	node("plain", { label: "Plain item", icon: "file" }),
	branch("selected", [node("child", { label: "Child item" })], {
		label: "Selected branch",
		icon: "folder-opened",
	}),
	branch("collapsed", [node("hidden", { label: "Hidden item" })], {
		label: "Collapsed branch",
		icon: "folder",
	}),
	node("action", {
		label: "Item with action",
		className: "story-row-action",
		action: <IconButton icon="trash" label="Delete item" />,
	}),
];
export const RowStates: Story = {
	parameters: {
		pseudo: { hover: [".story-row-action > .ui-tree-item__row"] },
	},
	render: () =>
		tree({
			"aria-label": "Tree row states",
			nodes: ROW_STATES,
			selectedItemId: "selected",
			expandedIds: ["selected"],
		}),
};
export const RowStatesStable: Story = {
	...RowStates,
	globals: { uiStyle: "stable" },
};

/** Two deep branches, so a short scroller always has ancestors to pin. */
const DEEP_FILES: readonly TreeNode[] = ["alpha", "beta"].map((name) =>
	branch(name, [
		branch(
			`${name}/src`,
			Array.from({ length: 12 }, (_, index) =>
				node(`${name}/src/file-${index}`, {
					label: `file-${index}.ts`,
					icon: "symbol-class",
				}),
			),
			{ label: "src" },
		),
	]),
);

export const StickyScroll: Story = {
	render: () => (
		<div
			data-testid="scroller"
			style={{ height: "140px", overflow: "auto", width: "280px" }}
			ref={(scroller) => {
				if (scroller) scroller.scrollTop = 143;
			}}
		>
			<TreeDemo
				aria-label="Sticky explorer"
				variant="explorer"
				stickyScroll
				nodes={DEEP_FILES}
			/>
		</div>
	),
	play: async ({ canvasElement }) => {
		await waitFor(() =>
			expect(
				canvasElement.querySelector(".ui-tree-sticky__rows"),
			).not.toBeNull(),
		);
		await expect(
			within(canvasElement).getByTestId("scroller").scrollTop,
		).toBeGreaterThan(0);
	},
};

export const MultiSelect: Story = {
	render: () =>
		tree({
			"aria-label": "Multi-select explorer",
			nodes: FILES,
			variant: "explorer",
			multiSelect: true,
			selectedItemIds: ["tree", "styles"],
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const treeElement = canvas.getByRole("tree");
		const readme = canvas.getByRole("treeitem", { name: "README.md" });
		await fireEvent.click(readme, { ctrlKey: true });
		await expect(readme).toHaveAttribute("aria-selected", "true");
		await expect(
			canvas.getByRole("treeitem", { name: "Tree.tsx" }),
		).toHaveAttribute("aria-selected", "true");
		await expect(canvasElement.ownerDocument.activeElement).toBe(treeElement);
		await expect(treeElement).toHaveAttribute(
			"aria-activedescendant",
			readme.id,
		);
	},
};

export const Focused: Story = {
	render: () =>
		tree({
			"aria-label": "Focused explorer",
			nodes: FILES,
			selectedItemId: "tree",
			variant: "explorer",
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const treeElement = canvas.getByRole("tree");
		const styles = canvas.getByRole("treeitem", { name: "Tree.css" });
		treeElement.focus();
		await waitFor(() => expect(treeElement).toHaveClass("ui-tree--focused"));
		await fireEvent.keyDown(treeElement, { key: "ArrowDown" });
		await expect(canvasElement.ownerDocument.activeElement).toBe(treeElement);
		await expect(treeElement).toHaveAttribute(
			"aria-activedescendant",
			styles.id,
		);
		await expect(styles).toHaveAttribute("aria-selected", "false");
	},
};

const NESTED_FILES: readonly TreeNode[] = [
	branch("src", [
		branch("components", [
			branch("Tree", [
				node("Tree.tsx", {
					icon: "symbol-class",
					className: "story-hover",
					action: closeAction("Tree.tsx"),
				}),
				node("TreeRow.tsx", { icon: "symbol-class" }),
				node("useTreeAdapter.ts", { icon: "symbol-method" }),
				branch("sticky", [node("StickyScroll.tsx", { icon: "symbol-class" })]),
			]),
		]),
	]),
	node("README.md", { icon: "markdown" }),
];
export const Nested: Story = {
	render: () =>
		tree({
			"aria-label": "Nested explorer",
			nodes: NESTED_FILES,
			selectedItemId: "StickyScroll.tsx",
			variant: "explorer",
		}),
	parameters: {
		pseudo: { hover: [".ui-tree", ".story-hover > .ui-tree-item__row"] },
	},
	play: async ({ canvasElement }) => {
		const deepLeaf = within(canvasElement).getByRole("treeitem", {
			name: "StickyScroll.tsx",
		});
		await expect(deepLeaf).toHaveAttribute("aria-level", "5");
		await userEvent.click(deepLeaf);
		await expect(deepLeaf).toHaveAttribute("aria-selected", "true");
	},
};

const LONG_NAME = "a-really-long-component-name-that-truncates.tsx";
const HOVER_FILES: readonly TreeNode[] = [
	branch(
		"hover-src",
		[
			node("hover-index", { label: "index.ts", icon: "symbol-method" }),
			node("hover-long", { label: LONG_NAME, icon: "symbol-class" }),
			node("hover-actions", {
				label: "Workspace",
				icon: "vm",
				action: (
					<>
						<IconButton icon="play" label="Start workspace" />
						<IconButton icon="gear" label="Workspace settings" />
					</>
				),
			}),
		],
		{ label: "src" },
	),
];

/** Leaves room above the rows, where a hover sits. */
const hoverTree = (ariaLabel: string, selectedItemId?: string) => (
	<div style={{ paddingTop: "40px" }}>
		{tree({
			"aria-label": ariaLabel,
			nodes: HOVER_FILES,
			selectedItemId,
		})}
	</div>
);

/** The bubble takes its x from the cursor, so give the pointer a real one. */
const hoverAt = async (element: Element): Promise<void> => {
	// An action bar is revealed by CSS, which lands a frame after the render.
	await waitFor(() =>
		expect(element.getBoundingClientRect().width).toBeGreaterThan(0),
	);
	const bounds = element.getBoundingClientRect();
	await userEvent.hover(element);
	await fireEvent.pointerMove(element, {
		clientX: bounds.left + 24,
		clientY: bounds.top + bounds.height / 2,
	});
};

/** The bubble is portalled, so it lands outside the story canvas. */
const expectBubble = async (content: string): Promise<void> => {
	const bubble = await screen.findByRole("tooltip");
	await waitFor(() => expect(bubble).toHaveTextContent(content));
};

export const Hover: Story = {
	render: () => hoverTree("Hovered label"),
	play: async ({ canvasElement }) => {
		const hovered = within(canvasElement).getByRole("treeitem", {
			name: LONG_NAME,
		});
		await hoverAt(hovered.getElementsByClassName("ui-tree-item__content")[0]);
		await expectBubble(LONG_NAME);
	},
};

export const HoverOnAction: Story = {
	// Selected so CSS reveals the action bar, which a synthetic hover cannot.
	render: () => hoverTree("Hovered action", "hover-actions"),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await hoverAt(
			canvas.getByRole("button", { name: "Start workspace", hidden: true }),
		);
		await expectBubble("Start workspace");
		// Crossing the same action bar swaps the bubble without a second delay.
		await hoverAt(
			canvas.getByRole("button", { name: "Workspace settings", hidden: true }),
		);
		await expectBubble("Workspace settings");
	},
};

export const HoverByKeyboard: Story = {
	render: () => hoverTree("Keyboard hover"),
	play: async ({ canvasElement }) => {
		const treeElement = within(canvasElement).getByRole("tree");
		treeElement.focus();
		await waitFor(() => expect(treeElement).toHaveClass("ui-tree--focused"));
		await fireEvent.keyDown(treeElement, { key: "ArrowDown" });
		await fireEvent.keyDown(treeElement, { key: "ArrowDown" });
		// VS Code binds list.showHover to this chord.
		await fireEvent.keyDown(treeElement, { key: "k", ctrlKey: true });
		await fireEvent.keyDown(treeElement, { key: "i", ctrlKey: true });
		await expectBubble(LONG_NAME);
	},
};
