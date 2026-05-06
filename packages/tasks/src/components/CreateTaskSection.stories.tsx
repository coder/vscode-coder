import { taskTemplate } from "@repo/mocks";
import { withQueryClient } from "@repo/storybook-utils";

import { withTasksStyles } from "../decorators";

import { CreateTaskSection } from "./CreateTaskSection";

import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta<typeof CreateTaskSection> = {
	title: "Tasks/CreateTaskSection",
	component: CreateTaskSection,
	decorators: [withTasksStyles, withQueryClient],
};

export default meta;
type Story = StoryObj<typeof CreateTaskSection>;

export const Default: Story = {
	args: {
		templates: [taskTemplate()],
	},
};
