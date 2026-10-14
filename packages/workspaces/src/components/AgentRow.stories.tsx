import { agent } from "@repo/mocks";
import { TooltipProvider, Tree, type TreeNode } from "@repo/ui";
import { fn } from "storybook/test";

import { AgentRow } from "./AgentRow";
import { WorkspaceActions } from "./WorkspaceActions";

import type { WorkspaceAgent } from "@repo/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";

const api = {
	openWorkspace: fn(),
	viewInDashboard: fn(),
	refresh: fn(),
	setFilter: fn(),
	watchAgents: fn(),
};

const PARENT = agent({ id: "parent", name: "main" });

const AGENTS: readonly WorkspaceAgent[] = [
	agent({ id: "connecting", name: "connecting", status: "connecting" }),
	agent({ id: "starting", name: "starting", lifecycle_state: "starting" }),
	agent({ id: "timeout", name: "timeout", status: "timeout" }),
	agent({ id: "unhealthy", name: "unhealthy", health: { healthy: false } }),
	agent({ id: "disconnected", name: "disconnected", status: "disconnected" }),
	agent({ id: "long", name: "an-agent-name-long-enough-to-truncate-the-row" }),
	agent({ id: "unknown", name: "" }),
];

const CHILDREN: readonly WorkspaceAgent[] = [
	agent({ id: "child", name: "devcontainer", parent_id: PARENT.id }),
	agent({
		id: "child-starting",
		name: "devcontainer-starting",
		parent_id: PARENT.id,
		lifecycle_state: "starting",
	}),
];

const agentNode = (
	value: WorkspaceAgent,
	hovered: string | undefined,
	children?: readonly TreeNode[],
): TreeNode => ({
	id: value.id,
	textValue: value.name || "Unknown",
	label: <AgentRow agent={value} />,
	className: value.id === hovered ? "story-hover" : undefined,
	action: (
		<WorkspaceActions
			workspaceId="workspace-1"
			name={value.name}
			agentId={value.id}
			api={api}
		/>
	),
	children,
});

const AgentRows = ({ hovered }: { hovered?: string }): React.JSX.Element => (
	<TooltipProvider>
		<Tree
			aria-label="Agents"
			className="workspaces-tree"
			expandedIds={[PARENT.id]}
			nodes={[
				agentNode(
					PARENT,
					hovered,
					CHILDREN.map((child) => agentNode(child, hovered)),
				),
				...AGENTS.map((value) => agentNode(value, hovered)),
			]}
		/>
	</TooltipProvider>
);

const meta: Meta<typeof AgentRows> = {
	title: "Workspaces/AgentRow",
	component: AgentRows,
};

export default meta;
type Story = StoryObj<typeof AgentRows>;

export const Statuses: Story = {};

export const Hovered: Story = {
	args: { hovered: "child" },
	parameters: {
		pseudo: { hover: [".story-hover > .ui-tree-item__row"] },
	},
};
