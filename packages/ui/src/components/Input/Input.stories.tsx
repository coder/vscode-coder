import { useState } from "react";
import { within } from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import { Input } from "./Input";

import type { Meta, StoryObj } from "@storybook/react-vite";

const InputStates = (): React.JSX.Element => {
	const [value, setValue] = useState("us-pittsburgh");
	return (
		<div style={{ display: "grid", gap: "8px", width: "260px" }}>
			<Input value={value} onChange={setValue} aria-label="Region" />
			<Input
				value=""
				onChange={() => undefined}
				placeholder="Instance type"
				aria-label="Placeholder"
			/>
			<Input
				value="8"
				onChange={() => undefined}
				type="number"
				min={1}
				max={16}
				aria-label="CPU cores"
			/>
			<Input
				value="read-only"
				onChange={() => undefined}
				disabled
				aria-label="Disabled"
			/>
		</div>
	);
};

const meta: Meta<typeof InputStates> = {
	title: "UI/Input",
	component: InputStates,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof InputStates>;

export const States: Story = {};

export const Focused: Story = {
	play: ({ canvasElement }) => {
		within(canvasElement).getByRole("textbox", { name: "Region" }).focus();
	},
};
