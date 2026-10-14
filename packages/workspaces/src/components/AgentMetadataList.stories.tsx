import {
	agentMetadata,
	PENDING_METADATA,
	REPORTED_METADATA,
} from "@repo/mocks";
import { TooltipProvider, Tree, type TreeNode } from "@repo/ui";

import { agentMetadataNodes } from "./AgentMetadataList";

import type { AgentMetadataState } from "@repo/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";

const STATES: ReadonlyArray<[string, AgentMetadataState]> = [
	["pending", PENDING_METADATA],
	["reported", REPORTED_METADATA],
	[
		"mixed",
		{
			kind: "reported",
			metadata: [
				agentMetadata({
					description: { key: "memory", display_name: "Memory" },
					result: { value: "3.1/8 GiB" },
				}),
				agentMetadata({
					description: { key: "disk", display_name: "Disk" },
					result: { value: "", error: "df: permission denied" },
				}),
				agentMetadata({
					description: { key: "load", display_name: "" },
					result: { value: "" },
				}),
				agentMetadata({
					description: {
						key: "branch",
						display_name: "A metadata name long enough to truncate",
					},
					result: { value: "feature/a-branch-name-that-is-also-long" },
				}),
			],
		},
	],
	["empty", { kind: "reported", metadata: [] }],
	["failed", { kind: "failed", error: "Agent unreachable" }],
];

const NODES: readonly TreeNode[] = STATES.map(([agentId, state]) => ({
	id: `heading:${agentId}`,
	label: "Agent metadata",
	className: "workspace-metadata-heading",
	children: agentMetadataNodes(agentId, state),
}));

const MetadataRows = (): React.JSX.Element => (
	<TooltipProvider>
		<Tree
			aria-label="Agent metadata"
			className="workspaces-tree"
			expandedIds={NODES.map((node) => node.id)}
			nodes={NODES}
		/>
	</TooltipProvider>
);

const meta: Meta<typeof MetadataRows> = {
	title: "Workspaces/AgentMetadataList",
	component: MetadataRows,
};

export default meta;
type Story = StoryObj<typeof MetadataRows>;

export const States: Story = {};
