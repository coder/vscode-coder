import { Meta, StoryObj } from "@storybook/react";
import { WorkspaceLogs } from "./WorkspaceLogs";
import * as M from "../testHelpers/entities";

const meta: Meta<typeof WorkspaceLogs> = {
	title: "Tasks/WorkspaceLogs",
	component: WorkspaceLogs,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof WorkspaceLogs>;

export const Default: Story = {
	args: {
		task: M.MockTask,
	},
};

export const BuildingWorkspace: Story = {
	args: {
		task: {
			...M.MockTask,
			workspace_status: "pending",
		},
	},
};
