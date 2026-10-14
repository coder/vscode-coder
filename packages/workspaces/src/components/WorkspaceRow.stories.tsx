import { workspace } from "@repo/mocks";
import { TooltipProvider, Tree } from "@repo/ui";
import { fn } from "storybook/test";

import { WorkspaceActions } from "./WorkspaceActions";
import { WorkspaceRow } from "./WorkspaceRow";

import type { Workspace } from "@repo/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";

const api = {
	openWorkspace: fn(),
	viewInDashboard: fn(),
	refresh: fn(),
	setFilter: fn(),
	watchAgents: fn(),
};

const WORKSPACES: readonly Workspace[] = [
	workspace({ id: "running", name: "running", owner_name: "alice" }),
	workspace({
		id: "starting",
		name: "starting",
		owner_name: "alice",
		latest_build: { status: "starting" },
	}),
	workspace({
		id: "failed",
		name: "failed",
		owner_name: "bob",
		latest_build: { status: "failed" },
	}),
	workspace({
		id: "unhealthy",
		name: "unhealthy",
		owner_name: "bob",
		health: { healthy: false, failing_agents: ["agent-1"] },
	}),
	workspace({
		id: "stopped",
		name: "stopped",
		owner_name: "carol",
		latest_build: { status: "stopped" },
	}),
	workspace({
		id: "long",
		name: "a-workspace-name-long-enough-to-truncate",
		owner_name: "an-owner-name-that-also-truncates",
	}),
	workspace({ id: "unknown", name: "", owner_name: "" }),
];

const WorkspaceRows = ({
	hovered,
}: {
	hovered?: string;
}): React.JSX.Element => (
	<TooltipProvider>
		<Tree
			aria-label="Workspaces"
			className="workspaces-tree"
			nodes={WORKSPACES.map((ws) => ({
				id: ws.id,
				textValue: `${ws.name} ${ws.owner_name}`,
				label: <WorkspaceRow workspace={ws} />,
				className: ws.id === hovered ? "story-hover" : undefined,
				action: (
					<WorkspaceActions workspaceId={ws.id} name={ws.name} api={api} />
				),
				children: [],
			}))}
		/>
	</TooltipProvider>
);

const meta: Meta<typeof WorkspaceRows> = {
	title: "Workspaces/WorkspaceRow",
	component: WorkspaceRows,
};

export default meta;
type Story = StoryObj<typeof WorkspaceRows>;

export const Statuses: Story = {};

export const Hovered: Story = {
	args: { hovered: "long" },
	parameters: {
		pseudo: { hover: [".story-hover > .ui-tree-item__row"] },
	},
};
