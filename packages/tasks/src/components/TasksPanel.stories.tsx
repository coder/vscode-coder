import { Meta, StoryObj } from "@storybook/react";
import { TasksPanel } from "./TasksPanel";
import { task } from "../../../../test/mocks/tasks";
import { withQueryClient } from "../../../../test/webview/decorators";
import { fn } from "@storybook/test";

const meta: Meta<typeof TasksPanel> = {
	title: "Tasks/TasksPanel",
	component: TasksPanel,
	decorators: [withQueryClient],
	tags: ["tasks"],
	parameters: {
		layout: "fullscreen",
	},
};

export default meta;
type Story = StoryObj<typeof TasksPanel>;

export const Default: Story = {
	args: {
		tasks: [task(), task(), task()],
		templates: [],
		persisted: {
			initialCreateExpanded: true,
			initialHistoryExpanded: true,
			save: fn(),
		},
	},
};
