import { FourThemeModes } from "#storybook";

import { StatusPill } from "./StatusPill";

import type { Meta, StoryObj } from "@storybook/react-vite";

const StatusPillTones = (): React.JSX.Element => (
	<div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
		<StatusPill icon="circle-outline">Pending</StatusPill>
		<StatusPill icon="info" tone="info">
			Starting
		</StatusPill>
		<StatusPill icon="check" tone="success">
			Running
		</StatusPill>
		<StatusPill icon="alert" tone="warning">
			Dormant
		</StatusPill>
		<StatusPill icon="error" tone="danger">
			Failed
		</StatusPill>
		<StatusPill>Awaiting infrastructure</StatusPill>
	</div>
);

const meta: Meta<typeof StatusPillTones> = {
	title: "UI/StatusPill",
	component: StatusPillTones,
	parameters: { chromatic: { modes: FourThemeModes } },
};
export default meta;
type Story = StoryObj<typeof StatusPillTones>;

export const Tones: Story = {};
