import { Meta, StoryObj } from "@storybook/react";
import { CreateTaskSection } from "./CreateTaskSection";
import { withQueryClient } from "../testHelpers/decorators";

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
		templates: [
			{
				id: "template-1",
				name: "Template 1",
				description: "Description for Template 1",
				activeVersionId: "version-1",
				presets: [
					{
						id: "preset-1",
						name: "Preset 1",
						description: "Description for Preset 1",
						isDefault: true,
					},
				],
			},
		],
	},
};
