import {
	agent,
	agentMetadata,
	app,
	appStatus,
	PENDING_METADATA,
	workspace,
} from "@repo/mocks";
import { fn, screen, userEvent, within } from "storybook/test";

import { WorkspacesPanel } from "./WorkspacesPanel";

import type { Workspace, WorkspacesState } from "@repo/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";

const WORKSPACES: readonly Workspace[] = [
	workspace({
		id: "ws-frontend",
		name: "frontend",
		owner_name: "alice",
		agents: [
			agent({
				id: "agent-main",
				name: "main",
				apps: [
					app({
						id: "claude",
						statuses: [appStatus({ id: "working", message: "Running tests" })],
					}),
					app({
						id: "codex",
						display_name: "Codex",
						statuses: [
							appStatus({
								id: "complete",
								state: "complete",
								message: "Opened a pull request",
							}),
						],
					}),
					app({
						id: "aider",
						display_name: "Aider",
						statuses: [
							appStatus({
								id: "failure",
								state: "failure",
								message: "Build failed",
							}),
						],
					}),
					app({
						id: "goose",
						display_name: "Goose",
						statuses: [appStatus({ id: "idle", state: "idle", message: "" })],
					}),
				],
			}),
			agent({
				id: "agent-devcontainer",
				name: "devcontainer",
				parent_id: "agent-main",
			}),
		],
	}),
	workspace({
		id: "ws-api",
		name: "api-server",
		owner_name: "bob",
		latest_build: { status: "starting" },
		agents: [
			agent({
				id: "agent-api",
				name: "main",
				lifecycle_state: "starting",
			}),
			agent({ id: "agent-worker", name: "worker", status: "connecting" }),
		],
	}),
	workspace({
		id: "ws-training",
		name: "ml-training-cluster-with-a-really-long-name",
		owner_name: "a-user-with-a-long-username",
		latest_build: { status: "failed" },
		agents: [
			agent({
				id: "agent-gpu",
				name: "gpu-node-with-an-equally-long-agent-name",
				status: "timeout",
			}),
		],
	}),
	workspace({
		id: "ws-unhealthy",
		name: "unhealthy",
		owner_name: "carol",
		health: { healthy: false, failing_agents: ["agent-sick"] },
		agents: [
			agent({
				id: "agent-sick",
				name: "main",
				health: { healthy: false, reason: "agent has lost connection" },
			}),
			agent({
				id: "agent-offline",
				name: "offline",
				status: "disconnected",
			}),
		],
	}),
	workspace({
		id: "ws-docs",
		name: "docs",
		owner_name: "carol",
		latest_build: { status: "stopped" },
	}),
	workspace({ id: "ws-unknown", name: "", owner_name: "" }),
];

const READY: WorkspacesState = {
	capabilities: { authenticated: true, filters: ["mine", "shared", "all"] },
	filter: "all",
	agentWorkspaceIds: ["ws-api"],
	workspaces: WORKSPACES,
	status: { kind: "ready" },
	// Local time, so it reads 2:05 PM in every time zone.
	listedAt: new Date(2024, 0, 1, 14, 5).getTime(),
	metadata: {
		"agent-main": {
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
		"agent-devcontainer": PENDING_METADATA,
		"agent-api": { kind: "reported", metadata: [] },
		"agent-gpu": { kind: "failed", error: "Agent unreachable" },
	},
};

const api = {
	login: fn(),
	openWorkspace: fn(),
	viewInDashboard: fn(),
	refresh: fn(),
	setFilter: fn(),
	watchAgents: fn(),
} as const;

const meta: Meta<typeof WorkspacesPanel> = {
	title: "Workspaces/WorkspacesPanel",
	component: WorkspacesPanel,
	decorators: [
		(Story) => (
			<div style={{ minHeight: 720 }}>
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
	args: { state: READY, api },
};

export default meta;
type Story = StoryObj<typeof WorkspacesPanel>;

export const Collapsed: Story = {};

export const Expanded: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const name of [
			"frontend alice",
			"ml-training-cluster-with-a-really-long-name a-user-with-a-long-username",
		]) {
			await userEvent.click(canvas.getByRole("treeitem", { name }));
		}
		for (const heading of canvas.getAllByRole("treeitem", {
			name: "Metadata",
		})) {
			await userEvent.click(heading);
		}
		await canvas.findByRole("treeitem", { name: "Memory: 3.1/8 GiB" });
	},
};

export const MenuOpen: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("treeitem", { name: "frontend alice" }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "More actions for frontend" }),
		);
		await screen.findByRole("menu");
	},
};

export const FilterOpen: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: "Workspace filter: All",
			}),
		);
		await screen.findByRole("menuitemradio", { name: "Shared" });
	},
};

const STATES: ReadonlyArray<
	readonly [label: string, state: WorkspacesState | undefined]
> = [
	["Loading", undefined],
	["Empty", { ...READY, workspaces: [] }],
	[
		"Signed out",
		{
			...READY,
			workspaces: [],
			capabilities: { authenticated: false, filters: [] },
		},
	],
	[
		"Failed",
		{
			...READY,
			workspaces: [],
			status: { kind: "failed", error: "Could not reach the deployment." },
		},
	],
	["Mine", { ...READY, filter: "mine" }],
	["Refreshing", { ...READY, status: { kind: "loading" } }],
	[
		"Out of date",
		{
			...READY,
			status: { kind: "failed", error: "Request timed out." },
		},
	],
];

export const States: Story = {
	parameters: { rootWidth: 640 },
	render: () => (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
				gap: 12,
			}}
		>
			{STATES.map(([label, state]) => (
				<div key={label}>
					<h2 style={{ fontSize: "inherit", margin: "0 0 4px" }}>{label}</h2>
					<div
						style={{
							height: 200,
							border: "1px solid var(--ui-border)",
							overflow: "hidden",
						}}
					>
						<WorkspacesPanel state={state} api={api} />
					</div>
				</div>
			))}
		</div>
	),
};
