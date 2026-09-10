import { useState } from "react";
import { userEvent, within } from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import { PasswordInput } from "./PasswordInput";

import type { Meta, StoryObj } from "@storybook/react-vite";

const PasswordInputStates = (): React.JSX.Element => {
	const [secret, setSecret] = useState("hunter2");
	return (
		<div style={{ display: "grid", gap: "8px", width: "260px" }}>
			<PasswordInput
				value={secret}
				onChange={setSecret}
				aria-label="API token"
			/>
			<PasswordInput
				value="hunter2"
				onChange={() => undefined}
				disabled
				aria-label="Disabled"
			/>
		</div>
	);
};

const meta: Meta<typeof PasswordInputStates> = {
	title: "UI/PasswordInput",
	component: PasswordInputStates,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof PasswordInputStates>;

export const States: Story = {};

export const Revealed: Story = {
	render: () => (
		<div style={{ width: "260px" }}>
			<PasswordInput
				value="hunter2"
				onChange={() => undefined}
				aria-label="API token"
			/>
		</div>
	),
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Show value" }),
		);
	},
};
