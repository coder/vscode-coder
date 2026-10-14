import { StatusDot, statusTone } from "./StatusDot";

import type { Meta, StoryObj } from "@storybook/react-vite";

const STATUSES = [
	"running",
	"connected",
	"starting",
	"connecting",
	"failed",
	"unhealthy",
	"timeout",
	"stopped",
	"disconnected",
];

const Tones = (): React.JSX.Element => (
	<div style={{ display: "grid", gap: "8px" }}>
		{STATUSES.map((status) => (
			<span
				key={status}
				style={{ display: "flex", alignItems: "center", gap: "8px" }}
			>
				<StatusDot status={status} tone={statusTone(status)} />
				{status}
			</span>
		))}
	</div>
);

const meta: Meta<typeof Tones> = {
	title: "Workspaces/StatusDot",
	component: Tones,
};

export default meta;
type Story = StoryObj<typeof Tones>;

export const AllTones: Story = {};
