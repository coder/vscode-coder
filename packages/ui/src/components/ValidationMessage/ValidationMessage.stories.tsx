import { PIXEL_ALL_THEMES } from "#storybook";

import { Input } from "../Input/Input";

import {
	ValidationMessage,
	type ValidationSeverity,
} from "./ValidationMessage";

import type { Meta, StoryObj } from "@storybook/react-vite";

const MESSAGES: ReadonlyArray<{
	severity: ValidationSeverity;
	value: string;
	message: string;
}> = [
	{ severity: "info", value: "dev", message: "Names are case-sensitive." },
	{
		severity: "warning",
		value: "4",
		message: "Fewer than 8 cores may slow down builds.",
	},
	{
		severity: "error",
		value: "32",
		message: "Value must be between 1 and 16.",
	},
];

const Messages = (): React.JSX.Element => (
	<div style={{ display: "grid", gap: "16px", width: "260px" }}>
		{MESSAGES.map(({ severity, value, message }) => (
			<div key={severity}>
				<Input
					aria-label={severity}
					aria-invalid={severity === "error" || undefined}
					value={value}
					onChange={() => undefined}
				/>
				<ValidationMessage severity={severity}>{message}</ValidationMessage>
			</div>
		))}
	</div>
);

const meta: Meta<typeof Messages> = {
	title: "UI/ValidationMessage",
	component: Messages,
	parameters: { pixel: PIXEL_ALL_THEMES },
};
export default meta;
type Story = StoryObj<typeof Messages>;

export const Severities: Story = {};
