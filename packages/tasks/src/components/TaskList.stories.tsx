import type { Meta, StoryObj } from "@storybook/react";
import { TaskList } from "./TaskList";
import { task } from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";
import { fn } from "@storybook/test";

const meta: Meta<typeof TaskList> = {
	title: "Tasks/TaskList",
	component: TaskList,
	decorators: [withQueryClient],
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof TaskList>;

export const Default: Story = {
	args: {
		tasks: [task(), task(), task()],
		onSelectTask: fn(),
	},
};
