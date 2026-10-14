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

const meta: Meta<typeof WorkspacesPanel> = {
	title: "Workspaces/WorkspacesPanel",
	component: WorkspacesPanel,
	args: {
		state: READY,
		api: {
			openWorkspace: fn(),
			viewInDashboard: fn(),
			refresh: fn(),
			setFilter: fn(),
			watchAgents: fn(),
		},
	},
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
	play: clickRows(
		"ml-training-cluster-with-a-really-long-name a-user-with-a-long-username",
		"api-server bob",
		"frontend alice",
	),
};

export const Metadata: Story = {
	play: async (context) => {
		await clickRows("frontend alice")(context);
		const canvas = within(context.canvasElement);
		// The child agent's metadata, then the parent's.
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

export const MetadataFailed: Story = {
	args: {
		state: {
			...READY,
			metadata: {
				"agent-main": { kind: "failed", error: "Agent unreachable" },
			},
		},
	},
	play: async (context) => {
		await clickRows("frontend alice")(context);
		const canvas = within(context.canvasElement);
		await userEvent.click(
			canvas.getAllByRole("treeitem", { name: "Agent metadata" })[1],
		);
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
	args: {
		state: {
			...READY,
			capabilities: { authenticated: true, filters: ["mine"] },
		},
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("combobox", { name: "Workspace filter" }),
		);
		await screen.findByRole("option", { name: "Shared" });
	},
};

export const Loading: Story = { args: { state: undefined } };

export const Refreshing: Story = {
	args: { state: { ...READY, status: { kind: "loading" } } },
	play: clickRows("frontend alice"),
};

export const FailedFirstLoad: Story = {
	args: {
		state: {
			...READY,
			workspaces: [],
			status: { kind: "failed", error: "Could not reach the deployment." },
		},
	},
};

export const FailedRefresh: Story = {
	args: {
		state: {
			...READY,
			status: { kind: "failed", error: "Request timed out." },
		},
	},
};

export const Empty: Story = {
	args: { state: { ...READY, workspaces: [] } },
};

export const SignedOut: Story = {
	args: {
		state: {
			...READY,
			workspaces: [],
			capabilities: { authenticated: false, filters: [] },
		},
	},
};
