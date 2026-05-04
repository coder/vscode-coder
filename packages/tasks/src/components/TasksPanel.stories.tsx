import { Meta, StoryObj } from "@storybook/react";
import { TasksPanel } from "./TasksPanel";
import * as M from "../testHelpers/entities";

const meta: Meta<typeof TasksPanel> = {
	title: "Tasks/TasksPanel",
	component: TasksPanel,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof TasksPanel>;

// TODO: We use a query client here, we should mock that?

// export const Default: Story = {
// 	args: {
// 		tasks: [M.MockTask, M.MockTask, M.MockTask],
// 		templates: [],
// 		persisted: {
// 			initialCreateExpanded: true,
// 			initialHistoryExpanded: true,
// 			save: () => {},
// 		},
// 	},
// };
