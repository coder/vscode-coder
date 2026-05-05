import type { Meta, StoryObj } from "@storybook/react";
import { WorkspaceLogs } from "./WorkspaceLogs";
import { task } from "../../../../test/mocks/tasks";

const meta: Meta<typeof WorkspaceLogs> = {
	title: "Tasks/WorkspaceLogs",
	component: WorkspaceLogs,
	tags: ["tasks"],
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
