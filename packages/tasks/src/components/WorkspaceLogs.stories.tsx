import { task } from "@repo/mocks";

import { WorkspaceLogs } from "./WorkspaceLogs";

import { withTasksStyles } from "../decorators";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof WorkspaceLogs> = {
	title: "Tasks/WorkspaceLogs",
	component: WorkspaceLogs,
	decorators: [withTasksStyles],
};

export default meta;
type Story = StoryObj<typeof WorkspaceLogs>;

export const Default: Story = {
	args: {
		task: task(),
	},
};

export const BuildingWorkspace: Story = {
	args: {
		task: task({ workspace_status: "pending" }),
	},
};
