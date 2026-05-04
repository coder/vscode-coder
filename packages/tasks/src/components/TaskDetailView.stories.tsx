import { Meta, StoryObj } from "@storybook/react";
import { TaskDetailView } from "./TaskDetailView";
import * as M from "../testHelpers/entities";
import { withQueryClient } from "../testHelpers/decorators";

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
		details: M.MockTaskDetails,
		onBack: () => console.log("Back clicked"),
	},
};
