import { fn } from "@storybook/test";

import { taskDetails } from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";

import { TaskDetailView } from "./TaskDetailView";

import type { Meta, StoryObj } from "@storybook/react";


const meta: Meta<typeof TaskDetailView> = {
	title: "Tasks/TaskDetailView",
	component: TaskDetailView,
	decorators: [withQueryClient],
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof TaskDetailView>;

export const Default: Story = {
	args: {
		details: taskDetails(),
		onBack: fn(),
	},
};
