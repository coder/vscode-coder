import { Meta, StoryObj } from "@storybook/react";
import { LogViewer, LogViewerPlaceholder } from "./LogViewer";

const meta: Meta<typeof LogViewer> = {
	title: "Tasks/LogViewer",
	component: LogViewer,
	tags: ["tasks"],
};

export default meta;
type Story = StoryObj<typeof LogViewer>;

export const Default: Story = {
	args: {
		header: "Task Logs",
		children: (
			<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
				<div>Entry 1</div>
				<div>Entry 2</div>
				<div>Entry 3</div>
			</div>
		),
	},
};

export const Loading: Story = {
	args: {
		header: "Task Logs",
		children: <LogViewerPlaceholder children={"Loading logs..."} />,
	},
};

export const WithError: Story = {
	args: {
		header: "Task Logs",
		children: <LogViewerPlaceholder error children={"Failed to load logs."} />,
	},
};
