import { useId, useState } from "react";

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

export const States: Story = {};
