import { useState } from "react";
import { userEvent, within } from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import { Tree } from "../Tree/Tree";

import { TreeFindWidget } from "./TreeFindWidget";

import type { Meta, StoryObj } from "@storybook/react-vite";

const NODES = ["alpha", "beta", "gamma", "delta"].map((name) => ({
	id: name,
	label: name,
	icon: "folder" as const,
}));

const FindInTree = (): React.JSX.Element => {
	const [value, setValue] = useState("");
	return (
		<div style={{ position: "relative", width: "300px", height: "160px" }}>
			<TreeFindWidget
				value={value}
				onChange={setValue}
				onClose={() => undefined}
			/>
			<Tree
				aria-label="Folders"
				nodes={NODES.filter(({ label }) => label.includes(value))}
			/>
		</div>
	);
};

const meta: Meta<typeof FindInTree> = {
	title: "UI/TreeFindWidget",
	component: FindInTree,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof FindInTree>;

export const Empty: Story = {};

export const Filtering: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			await canvas.findByRole("searchbox", { name: "Type to search" }),
			"a",
		);
	},
};
