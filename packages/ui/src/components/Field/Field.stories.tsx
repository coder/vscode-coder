import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import { Input } from "../Input/Input";

import { Field } from "./Field";

import type { Meta, StoryObj } from "@storybook/react-vite";

const FieldStates = (): React.JSX.Element => {
	const [region, setRegion] = useState("us-pittsburgh");
	return (
		<div style={{ display: "grid", gap: "16px", width: "260px" }}>
			<Field
				label="Region"
				htmlFor="region"
				description="Deploy the workspace close to you."
			>
				<Input id="region" value={region} onChange={setRegion} />
			</Field>
			<Field
				label="CPU cores"
				htmlFor="cores"
				error="Value must be between 1 and 16."
			>
				<Input id="cores" type="number" value="32" onChange={() => undefined} />
			</Field>
		</div>
	);
};

const meta: Meta<typeof FieldStates> = {
	title: "UI/Field",
	component: FieldStates,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof FieldStates>;

export const States: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByText("Region"));
		await expect(canvas.getByLabelText("Region")).toHaveFocus();
	},
};
