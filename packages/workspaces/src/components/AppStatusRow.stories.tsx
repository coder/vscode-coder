import { agent, app, appStatus } from "@repo/mocks";
import { TooltipProvider, Tree } from "@repo/ui";

import { AgentRow } from "./AgentRow";
import { appStatusNodes } from "./AppStatusRow";

import type { Meta, StoryObj } from "@storybook/react-vite";

const AGENT = agent({
	apps: [
		app({
			statuses: [
				appStatus({
					id: "complete",
					state: "complete",
					message: "Opened a pull request",
				}),
				appStatus({ id: "working", message: "Running the test suite" }),
				appStatus({
					id: "failure",
					state: "failure",
					message: "Build failed: a message long enough to truncate the row",
				}),
			],
		}),
		app({
			id: "aider",
			slug: "aider",
			display_name: "",
			statuses: [appStatus({ id: "idle", state: "idle", message: "" })],
		}),
	],
});

const AppStatusRows = (): React.JSX.Element => (
	<TooltipProvider>
		<Tree
			aria-label="App statuses"
			className="workspaces-tree"
			expandedIds={[AGENT.id]}
			nodes={[
				{
					id: AGENT.id,
					textValue: AGENT.name,
					label: <AgentRow agent={AGENT} />,
					children: appStatusNodes(AGENT),
				},
			]}
		/>
	</TooltipProvider>
);

const meta: Meta<typeof AppStatusRows> = {
	title: "Workspaces/AppStatusRow",
	component: AppStatusRows,
};

export default meta;
type Story = StoryObj<typeof AppStatusRows>;

export const States: Story = {};
