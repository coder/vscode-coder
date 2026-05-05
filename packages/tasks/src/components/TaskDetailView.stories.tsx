import { Meta, StoryObj } from "@storybook/react";
import { TaskDetailView } from "./TaskDetailView";
import { taskDetails } from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";
import { fn } from "@storybook/test";

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
		onBack: () => fn(),
	},
};
