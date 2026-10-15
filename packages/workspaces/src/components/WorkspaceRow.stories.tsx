import {
	agent,
	agentMetadata,
	app,
	appStatus,
	PENDING_METADATA,
	workspace,
} from "@repo/mocks";
import { TooltipProvider, Tree, type TreeNode } from "@repo/ui";
import { useState } from "react";
import { expect, fn, screen, userEvent, within } from "storybook/test";

import { agentMetadataNodes } from "./AgentMetadataList";
import { AgentRow } from "./AgentRow";
import { appStatusNodes } from "./AppStatusRow";
import { WorkspaceActions } from "./WorkspaceActions";
import { WorkspaceRow, workspaceTooltip } from "./WorkspaceRow";

import type {
	AgentMetadataState,
	Workspace,
	WorkspaceAgent,
} from "@repo/shared";
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

const MAIN = agent({ id: "main", name: "main" });
const AGENTS = [
	MAIN,
	agent({ id: "connecting", name: "connecting", status: "connecting" }),
	agent({
		id: "starting-agent",
		name: "starting",
		lifecycle_state: "starting",
	}),
	agent({ id: "timeout", name: "timeout", status: "timeout" }),
	agent({ id: "disconnected", name: "disconnected", status: "disconnected" }),
];

function agentNode(
	value: WorkspaceAgent,
	children?: readonly TreeNode[],
): TreeNode {
	return {
		id: value.id,
		textValue: value.name,
		tooltip: `Status: ${value.status}`,
		label: <AgentRow agent={value} />,
		action: (
			<WorkspaceActions
				workspaceId="workspace-1"
				name={value.name}
				agentId={value.id}
				api={api}
			/>
		),
		children,
	};
}

function ComponentRows() {
	const [expandedIds, setExpandedIds] = useState<readonly string[]>([
		"workspaces",
		"agents",
		MAIN.id,
	]);
	const [selectedItemId, setSelectedItemId] = useState<string>();
	return (
		<TooltipProvider>
			<Tree
				aria-label="Workspace and agent rows"
				expandedIds={expandedIds}
				onExpandedIdsChange={setExpandedIds}
				selectedItemId={selectedItemId}
				onSelectedItemChange={setSelectedItemId}
				nodes={[
					{
						id: "workspaces",
						label: "Workspaces",
						children: WORKSPACES.map((ws) => ({
							id: `ws:${ws.id}`,
							textValue: `${ws.name || "Unknown"} ${ws.owner_name || "Unknown"}`,
							tooltip: workspaceTooltip(ws),
							label: <WorkspaceRow workspace={ws} />,
							action: (
								<WorkspaceActions
									workspaceId={ws.id}
									name={ws.name || "Unknown"}
									status={ws.latest_build.status}
									api={api}
								/>
							),
						})),
					},
					{
						id: "agents",
						label: "Agents",
						children: AGENTS.map((value) =>
							agentNode(
								value,
								value.id === MAIN.id
									? [
											agentNode(
												agent({
													id: "devcontainer",
													name: "devcontainer",
													parent_id: MAIN.id,
												}),
											),
										]
									: undefined,
							),
						),
					},
				]}
			/>
		</TooltipProvider>
	);
}

const DETAILS: ReadonlyArray<[WorkspaceAgent, AgentMetadataState]> = [
	[
		agent({
			id: "reported",
			name: "main",
			apps: [
				app({
					statuses: [
						appStatus({
							id: "complete",
							state: "complete",
							message: "Opened a pull request",
						}),
						appStatus({ id: "working", message: "Running tests" }),
						appStatus({
							id: "failure",
							state: "failure",
							message: "Build failed",
						}),
						appStatus({ id: "idle", state: "idle", message: "" }),
					],
				}),
			],
		}),
		{
			kind: "reported",
			metadata: [
				agentMetadata(),
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
	[agent({ id: "pending", name: "Awaiting metadata" }), PENDING_METADATA],
	[
		agent({ id: "empty", name: "No metadata" }),
		{ kind: "reported", metadata: [] },
	],
	[
		agent({ id: "failed", name: "Metadata unavailable" }),
		{ kind: "failed", error: "Agent unreachable" },
	],
];

function AgentDetails() {
	const [expandedIds, setExpandedIds] = useState<readonly string[]>(
		DETAILS.flatMap(([value]) => [value.id, `metadata:${value.id}`]),
	);
	return (
		<TooltipProvider>
			<Tree
				aria-label="Agent details"
				expandedIds={expandedIds}
				onExpandedIdsChange={setExpandedIds}
				nodes={DETAILS.map(([value, metadata]) =>
					agentNode(value, [
						...appStatusNodes(value),
						{
							id: `metadata:${value.id}`,
							label: "Agent metadata",
							className: "workspace-metadata-heading",
							children: agentMetadataNodes(value.id, metadata),
						},
					]),
				)}
			/>
		</TooltipProvider>
	);
}

const meta: Meta<typeof ComponentRows> = {
	title: "Workspaces/Components",
	component: ComponentRows,
	decorators: [
		(Story) => (
			<div style={{ width: 300, maxWidth: "calc(100vw - 32px)" }}>
				<Story />
			</div>
		),
	],
	parameters: {
		pixel: {
			matrix: {
				themes: ["light", "dark", "high-contrast", "high-contrast-light"],
			},
		},
	},
};

export default meta;
type Story = StoryObj<typeof ComponentRows>;

export const Rows: Story = {};

export const AgentDetailStates: Story = { render: () => <AgentDetails /> };

export const RowTooltip: Story = {
	play: async ({ canvasElement }) => {
		const row = within(canvasElement).getByRole("treeitem", {
			name: "a-workspace-name-long-enough-to-truncate an-owner-name-that-also-truncates",
		});
		await userEvent.hover(
			within(row).getByText("a-workspace-name-long-enough-to-truncate"),
		);
		await expect(await screen.findByRole("tooltip")).toHaveTextContent(
			"Template: Test Template • Status: Running",
		);
	},
};

export const ActionTooltip: Story = {
	play: async ({ canvasElement }) => {
		const row = within(canvasElement).getByRole("treeitem", {
			name: "running alice",
		});
		await userEvent.click(row);
		await userEvent.hover(
			within(row).getByRole("button", { name: "Open running in VS Code" }),
		);
		await expect(await screen.findByRole("tooltip")).toHaveTextContent(
			/^Open in VS Code$/,
		);
	},
};

export const MetadataTooltip: Story = {
	render: () => <AgentDetails />,
	play: async ({ canvasElement }) => {
		const row = within(canvasElement).getByRole("treeitem", {
			name: "CPU: 42",
		});
		await userEvent.hover(within(row).getByText("CPU:"));
		await expect(await screen.findByRole("tooltip")).toHaveTextContent(
			"Collected at 2024-01-01T00:00:00Z",
		);
	},
};
