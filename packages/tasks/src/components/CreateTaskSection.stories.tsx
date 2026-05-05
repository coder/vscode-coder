import { Meta, StoryObj } from "@storybook/react";
import { CreateTaskSection } from "./CreateTaskSection";
import { withQueryClient } from "../../../../test/webview/decorators";
import * as M from "../../../../test/mocks/tasks";

const meta: Meta<typeof CreateTaskSection> = {
	title: "Tasks/CreateTaskSection",
	component: CreateTaskSection,
	decorators: [withQueryClient],
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof CreateTaskSection>;

export const Default: Story = {
	args: {
		templates: [M.MockTemplate],
	},
};
