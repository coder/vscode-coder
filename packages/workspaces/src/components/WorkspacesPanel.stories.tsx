import { agent, agentMetadata, workspace } from "@repo/mocks";
import { expect, fn, screen, userEvent, within } from "storybook/test";

import { WorkspacesPanel } from "./WorkspacesPanel";

import type { WorkspacesState } from "@repo/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";

const WORKSPACES = [
	workspace({
		id: "ws-frontend",
		name: "frontend",
		owner_name: "alice",
		agents: [
			agent({ id: "agent-main", name: "main" }),
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
				status: "connecting",
				lifecycle_state: "created",
			}),
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
		id: "ws-docs",
		name: "docs",
		owner_name: "carol",
		latest_build: { status: "stopped" },
	}),
];

const READY: WorkspacesState = {
	capabilities: { authenticated: true, filters: ["mine", "shared", "all"] },
	filter: "mine",
	agentWorkspaceIds: ["ws-api"],
	workspaces: WORKSPACES,
	status: { kind: "ready" },
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
			],
		},
		"agent-devcontainer": { kind: "pending" },
	},
};

const api = {
	openWorkspace: fn(),
	viewInDashboard: fn(),
	refresh: fn(),
	setFilter: fn(),
	watchAgents: fn(),
};

const meta: Meta<typeof WorkspacesPanel> = {
	title: "Workspaces/WorkspacesPanel",
	component: WorkspacesPanel,
	decorators: [
		(Story) => (
			<div style={{ height: 480 }}>
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

type Play = NonNullable<Story["play"]>;

const clickRows =
	(...names: string[]): Play =>
	async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const name of names) {
			await userEvent.click(canvas.getByRole("treeitem", { name }));
		}
	};

export const Collapsed: Story = {};

export const Expanded: Story = {
	play: async (context) => {
		await clickRows("frontend alice")(context);
		const canvas = within(context.canvasElement);

		for (const heading of canvas.getAllByRole("treeitem", {
			name: "Agent metadata",
		})) {
			await userEvent.click(heading);
		}
		await expect(
			await canvas.findByRole("treeitem", { name: "Memory: 3.1/8 GiB" }),
		).toBeVisible();
	},
};

export const MenuOpen: Story = {
	play: async (context) => {
		await clickRows("frontend alice")(context);
		await userEvent.click(
			within(context.canvasElement).getByRole("button", {
				name: "More actions for frontend",
			}),
		);
		await screen.findByRole("menu");
	},
};

export const FilterOpen: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("combobox", { name: "Workspace filter" }),
		);
		await screen.findByRole("option", { name: "Shared" });
	},
};

const STATES: ReadonlyArray<[string, WorkspacesState | undefined]> = [
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
	["Refreshing", { ...READY, status: { kind: "loading" } }],
	[
		"Failed refresh",
		{ ...READY, status: { kind: "failed", error: "Request timed out." } },
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
