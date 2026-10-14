import { fn, screen, userEvent, within } from "storybook/test";

import { WorkspaceActions } from "./WorkspaceActions";

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta<typeof WorkspaceActions> = {
	title: "Workspaces/WorkspaceActions",
	component: WorkspaceActions,
	args: {
		workspaceId: "workspace-1",
		name: "frontend",
		api: {
			openWorkspace: fn(),
			viewInDashboard: fn(),
			refresh: fn(),
			setFilter: fn(),
			watchAgents: fn(),
		},
	},
	decorators: [
		(Story) => (
			<div style={{ display: "flex", gap: "2px" }}>
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof WorkspaceActions>;

export const Workspace: Story = {};

export const Agent: Story = {
	args: { name: "main", agentId: "agent-1" },
};

export const MenuOpen: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "More actions for frontend",
			}),
		);
		(await screen.findByRole("menuitem", { name: "Settings" })).focus();
	},
};
