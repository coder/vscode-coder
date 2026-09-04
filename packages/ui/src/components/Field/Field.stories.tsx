import { useId, useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { PIXEL_ALL_THEMES } from "#storybook";

import { Input } from "../Input/Input";

import { Field } from "./Field";

import type { Meta, StoryObj } from "@storybook/react-vite";

const FieldStates = (): React.JSX.Element => {
	const [region, setRegion] = useState("us-pittsburgh");
	const regionId = useId();
	const coresId = useId();
	return (
		<div style={{ display: "grid", gap: "16px", width: "260px" }}>
			<Field
				label="Region"
				htmlFor={regionId}
				description="Deploy the workspace close to you."
				descriptionId={`${regionId}-description`}
			>
				<Input
					id={regionId}
					value={region}
					onChange={setRegion}
					aria-describedby={`${regionId}-description`}
				/>
			</Field>
			<Field
				label="CPU cores"
				htmlFor={coresId}
				error="Value must be between 1 and 16."
				errorId={`${coresId}-error`}
			>
				<Input
					id={coresId}
					type="number"
					value="32"
					onChange={() => undefined}
					aria-describedby={`${coresId}-error`}
					aria-invalid="true"
				/>
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
		await expect(canvas.getByLabelText("Region")).toHaveAccessibleDescription(
			"Deploy the workspace close to you.",
		);
		await expect(
			canvas.getByLabelText("CPU cores"),
		).toHaveAccessibleDescription("Value must be between 1 and 16.");
		await expect(canvas.getByLabelText("CPU cores")).toBeInvalid();
	},
};
