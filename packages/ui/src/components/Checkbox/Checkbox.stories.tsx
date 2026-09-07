import { useState } from "react";

import { PIXEL_ALL_THEMES } from "#storybook";

import { Checkbox } from "./Checkbox";

import type { Meta, StoryObj } from "@storybook/react-vite";

const CheckboxStates = (): React.JSX.Element => {
	const [checked, setChecked] = useState(true);
	return (
		<div style={{ display: "grid", gap: "8px", justifyItems: "start" }}>
			<Checkbox checked={checked} onChange={setChecked}>
				Start on connect
			</Checkbox>
			<Checkbox checked={false} onChange={() => undefined}>
				Unchecked
			</Checkbox>
			<Checkbox checked disabled onChange={() => undefined}>
				Disabled checked
			</Checkbox>
			<Checkbox checked={false} disabled onChange={() => undefined}>
				Disabled unchecked
			</Checkbox>
		</div>
	);
};

const meta: Meta<typeof CheckboxStates> = {
	title: "UI/Checkbox",
	component: CheckboxStates,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof CheckboxStates>;

export const States: Story = {};
