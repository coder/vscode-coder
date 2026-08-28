import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import { Textarea } from "./Textarea";

import type { Meta, StoryObj } from "@storybook/react-vite";

const TextareaStates = (): React.JSX.Element => {
	const [value, setValue] = useState("#!/bin/sh\necho hello");
	return (
		<div style={{ display: "grid", gap: "8px", width: "260px" }}>
			<Textarea value={value} onChange={setValue} aria-label="Init script" />
			<Textarea
				value=""
				onChange={() => undefined}
				placeholder="Optional notes"
				aria-label="Placeholder"
			/>
			<Textarea
				value="read-only"
				onChange={() => undefined}
				disabled
				aria-label="Disabled"
			/>
		</div>
	);
};

const meta: Meta<typeof TextareaStates> = {
	title: "UI/Textarea",
	component: TextareaStates,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof TextareaStates>;

export const States: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const script = canvas.getByLabelText("Init script");
		await userEvent.type(script, "!");
		await expect(script).toHaveValue("#!/bin/sh\necho hello!");
	},
};
