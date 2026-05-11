import { taskDetails } from "@repo/mocks";
import { withQueryClient } from "@repo/storybook-utils";
import { fn } from "storybook/test";

import { TaskDetailView } from "./TaskDetailView";

import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta<typeof TaskDetailView> = {
	title: "Tasks/TaskDetailView",
	component: TaskDetailView,
	decorators: [withQueryClient],
};

export default meta;
type Story = StoryObj<typeof TaskDetailView>;

export const Default: Story = {
	args: {
		details: taskDetails(),
		onBack: fn(),
	},
};

export const Error: Story = {
	args: {
		details: taskDetails({
			task: {
				status: "error",
				current_state: {
					timestamp: "2024-01-01T00:00:00Z",
					state: "failed",
					message: "Task execution failed",
					uri: "",
				},
			},
		}),
		onBack: fn(),
	},
};

export const WorkspaceStarting: Story = {
	args: {
		details: taskDetails({
			task: {
				workspace_status: "starting",
				current_state: {
					timestamp: "2024-01-01T00:00:00Z",
					state: "working",
					message: "Starting workspace",
					uri: "",
				},
			},
		}),
		onBack: fn(),
	},
};

export const AgentStarting: Story = {
	args: {
		details: taskDetails({
			task: {
				workspace_status: "running",
				workspace_agent_lifecycle: "starting",
				current_state: {
					timestamp: "2024-01-01T00:00:00Z",
					state: "working",
					message: "Agent initializing",
					uri: "",
				},
			},
		}),
		onBack: fn(),
	},
};
