import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { format, formatISO } from "date-fns";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { agent, agentMetadata, app, appStatus, workspace } from "@repo/mocks";
import { WorkspacesApi, type WorkspacesState } from "@repo/shared";
import App from "@repo/workspaces/App";

import {
	activeRow,
	row,
	stubElementBoxes,
} from "../../ui/components/Tree/treeTestHelpers";
import { captureSent, pushState } from "../ipc";

const ALPHA = workspace({
	id: "ws-alpha",
	name: "alpha",
	owner_name: "alice",
	agents: [
		agent({ id: "agent-main", name: "main" }),
		agent({ id: "agent-dev", name: "dev", parent_id: "agent-main" }),
	],
});
const BETA = workspace({
	id: "ws-beta",
	name: "beta",
	owner_name: "bob",
	latest_build: { status: "stopped" },
	agents: [
		agent({
			id: "agent-beta",
			name: "beta-main",
			apps: [
				app({
					statuses: [
						appStatus({ id: "mid", created_at: "2024-01-01T00:01:00Z" }),
						appStatus({
							id: "newest",
							created_at: "2024-01-01T00:02:00Z",
							state: "complete",
							message: "Opened a pull request",
						}),
						appStatus({ id: "oldest" }),
					],
				}),
			],
		}),
	],
});

const STATE: WorkspacesState = {
	capabilities: { authenticated: true, filters: ["mine", "shared"] },
	filter: "mine",
	workspaces: [ALPHA, BETA],
	status: { kind: "ready" },
	metadata: {},
};

const SIGNED_OUT: WorkspacesState = {
	...STATE,
	workspaces: [],
	capabilities: { authenticated: false, filters: [] },
};

async function setup(state: WorkspacesState | null = STATE) {
	const sent = captureSent();
	const user = userEvent.setup();
	const view = render(<App />);
	if (state) {
		await pushState(state);
	}
	sent.length = 0;
	/** Params of the `method` commands sent since the last call for it. */
	const drain = (method: string) => {
		const params = sent.filter((m) => m.method === method).map((m) => m.params);
		sent.splice(0, sent.length, ...sent.filter((m) => m.method !== method));
		return params;
	};
	return { user, drain, ...view };
}

const hoverDetails = (tooltip: HTMLElement) =>
	within(tooltip)
		.getAllByRole("term")
		.map((term) => [term.textContent, term.nextElementSibling?.textContent]);

/** Show the focused row's hover, as Ctrl+K Ctrl+I does in VS Code. */
const showHover = async (user: ReturnType<typeof userEvent.setup>) => {
	await user.keyboard("{Control>}k{/Control}{Control>}i{/Control}");
	return screen.findByRole("tooltip");
};

describe("WorkspacesPanel", () => {
	it("offers only the filters the session allows", async () => {
		const { user, drain } = await setup();
		await user.click(
			screen.getByRole("button", { name: "Workspace filter: Mine" }),
		);

		expect(
			await screen.findByRole("menuitemradio", { name: "All" }),
		).toHaveAttribute("aria-disabled", "true");
		await user.click(screen.getByRole("menuitemradio", { name: "All" }));
		expect(drain(WorkspacesApi.setFilter.method)).toEqual([]);

		expect(screen.getByRole("menuitemradio", { name: "Mine" })).toHaveAttribute(
			"aria-checked",
			"true",
		);
		await user.click(screen.getByRole("menuitemradio", { name: "Shared" }));
		expect(drain(WorkspacesApi.setFilter.method)).toEqual([
			{ filter: "shared" },
		]);
		await waitFor(() => {
			expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		});
		await pushState({ ...STATE, filter: "shared" });
		expect(
			screen.getByRole("button", { name: "Workspace filter: Shared" }),
		).toBeVisible();
	});

	it("shows owners outside of Mine", async () => {
		await setup();
		expect(within(row("alpha")).queryByText("alice")).not.toBeInTheDocument();
		await pushState({ ...STATE, filter: "all" });
		expect(within(row("alpha alice")).getByText("alice")).toBeVisible();
	});

	it.each([
		["starting", "Starting"],
		["stopped", "Stopped"],
	] as const)(
		"shows %s despite health from a previous build",
		async (status, label) => {
			await setup({
				...STATE,
				workspaces: [
					workspace({
						latest_build: { status },
						health: { healthy: false, failing_agents: [] },
					}),
				],
			});
			expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
		},
	);

	it("marks workspaces associated with Agent chats", async () => {
		await setup({ ...STATE, agentWorkspaceIds: [ALPHA.id] });
		expect(
			within(row("alpha Agent")).getByText("Agent", { exact: true }),
		).toBeVisible();
		expect(
			within(row("beta")).queryByText("Agent", { exact: true }),
		).not.toBeInTheDocument();
	});

	it("sends row actions for their own row without toggling it", async () => {
		const { user, drain } = await setup();
		await user.click(
			screen.getByRole("button", { name: "Open alpha in VS Code" }),
		);
		await user.click(
			screen.getByRole("button", { name: "View alpha in dashboard" }),
		);
		expect(row("alpha")).toHaveAttribute("aria-expanded", "false");

		await user.click(row("alpha"));
		await user.click(
			screen.getByRole("button", { name: "Open dev in VS Code" }),
		);
		expect(
			screen.queryByRole("button", { name: "More actions for dev" }),
		).not.toBeInTheDocument();

		expect(drain(WorkspacesApi.openWorkspace.method)).toEqual([
			{ workspaceId: "ws-alpha" },
			{ workspaceId: "ws-alpha", agentId: "agent-dev" },
		]);
		expect(drain(WorkspacesApi.viewInDashboard.method)).toEqual([
			{ workspaceId: "ws-alpha", page: "workspace" },
		]);
	});

	it("opens workspace settings from the menu", async () => {
		const { user, drain } = await setup();
		await user.click(
			screen.getByRole("button", { name: "More actions for beta" }),
		);
		const menu = await screen.findByRole("menu");
		await user.click(within(menu).getByRole("menuitem", { name: "Settings" }));
		expect(drain(WorkspacesApi.viewInDashboard.method)).toEqual([
			{ workspaceId: "ws-beta", page: "settings" },
		]);
	});

	it.each([
		["running", ["Stop", "Restart"]],
		["stopped", ["Start"]],
		["canceled", ["Retry"]],
		["starting", []],
	] as const)(
		"offers lifecycle actions appropriate to %s",
		async (status, actions) => {
			const { user } = await setup({
				...STATE,
				workspaces: [workspace({ latest_build: { status } })],
			});
			await user.click(
				screen.getByRole("button", { name: "More actions for test-workspace" }),
			);
			const menu = await screen.findByRole("menu");
			for (const name of ["Start", "Stop", "Restart", "Retry"]) {
				const item = within(menu).queryByRole("menuitem", { name });
				if (actions.some((action) => action === name)) {
					expect(item).toHaveAttribute("aria-disabled", "true");
				} else {
					expect(item).not.toBeInTheDocument();
				}
			}
		},
	);

	it("describes workspaces, workspace agents and metadata on hover", async () => {
		stubElementBoxes();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime("2024-01-01T00:00:05Z");
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const { user } = await setup({
			...STATE,
			filter: "all",
			agentWorkspaceIds: ["workspace-1"],
			workspaces: [
				workspace({
					owner_name: "alice",
					template_display_name: "Go",
					template_name: "go-template",
					health: { healthy: false, failing_agents: ["agent-1"] },
					agents: [agent({ name: "primary", status: "connecting" })],
				}),
			],
			metadata: {
				"agent-1": { kind: "reported", metadata: [agentMetadata()] },
			},
		});
		await user.click(row("test-workspace Agent alice"));
		let hover = await showHover(user);
		expect(within(hover).getByText("test-workspace")).toBeVisible();
		expect(hoverDetails(hover)).toEqual([
			["Status", "Unhealthy"],
			["Owner", "alice"],
			["Template", "Go"],
		]);

		await user.keyboard("{Escape}{ArrowDown}");
		hover = await showHover(user);
		expect(within(hover).getByText("primary")).toBeVisible();
		expect(hoverDetails(hover)).toEqual([
			["Status", "Connecting"],
			["Type", "Workspace agent"],
		]);
		await user.keyboard("{Escape}");

		await user.click(row("Metadata"));
		await user.click(row("CPU: 42"));
		expect(await showHover(user)).toHaveTextContent(
			"CPU: 42Collected 5 seconds ago",
		);
	});

	it("watches metadata only for the workspace agents whose metadata is visible", async () => {
		const { user, drain } = await setup();
		const watches = () => drain(WorkspacesApi.watchAgents.method);
		act(() => screen.getByRole("tree").focus());

		await user.keyboard("{ArrowRight}{ArrowRight}");
		expect(activeRow()).toBe("main");
		expect(row("dev")).toHaveAttribute("aria-level", "3");
		expect(watches()).toEqual([]);

		// Below main: dev, dev's metadata, then main's metadata.
		await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}");
		expect(watches()).toEqual([{ agentIds: ["agent-main"] }]);
		expect(
			screen.getByRole("status", { name: "Loading metadata" }),
		).toBeInTheDocument();

		await pushState({
			...STATE,
			metadata: {
				"agent-main": { kind: "reported", metadata: [agentMetadata()] },
			},
		});
		expect(row("CPU: 42")).toBeInTheDocument();
		expect(watches()).toEqual([]);

		await user.keyboard("{ArrowUp}{ArrowRight}");
		expect(watches()).toEqual([{ agentIds: ["agent-dev", "agent-main"] }]);

		await user.click(row("main"));
		expect(watches()).toEqual([{ agentIds: [] }]);
		await user.click(row("main"));
		expect(watches()).toEqual([{ agentIds: ["agent-dev", "agent-main"] }]);

		await user.click(row("alpha"));
		expect(watches()).toEqual([{ agentIds: [] }]);
	});

	it("shows only each app's latest status under the agent", async () => {
		const { user } = await setup();
		await user.click(row("beta"));
		expect(row("Claude Code: Opened a pull request")).toHaveAttribute(
			"aria-level",
			"3",
		);
		expect(
			screen.queryByRole("treeitem", { name: /Running tests/ }),
		).not.toBeInTheDocument();
	});

	it("explains when an expanded workspace has no workspace agents", async () => {
		const { user } = await setup({
			...STATE,
			workspaces: [workspace({ name: "empty", owner_name: "alice" })],
		});
		await user.click(row("empty"));
		expect(row("No workspace agents")).toBeInTheDocument();
	});

	it.each<{
		name: string;
		state: WorkspacesState | null;
		visible: { role: string; name: string };
	}>([
		{
			name: "loading before the first state",
			state: null,
			visible: { role: "status", name: "Loading workspaces" },
		},
		{
			name: "loading the first list",
			state: { ...STATE, workspaces: [], status: { kind: "loading" } },
			visible: { role: "status", name: "Loading workspaces" },
		},
		{
			name: "an empty list",
			state: { ...STATE, workspaces: [] },
			visible: { role: "heading", name: "No workspaces" },
		},
	])("shows $name", async ({ state, visible }) => {
		await setup(state);
		expect(
			screen.getByRole(visible.role, { name: visible.name }),
		).toBeVisible();
		expect(screen.queryByRole("tree")).not.toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("offers to log in when signed out", async () => {
		const { user, drain } = await setup(SIGNED_OUT);
		expect(
			screen.getByRole("heading", { name: "Welcome to Coder" }),
		).toBeVisible();
		expect(
			screen.queryByRole("button", { name: /^Workspace filter:/ }),
		).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Login" }));
		expect(drain(WorkspacesApi.login.method)).toEqual([undefined]);
	});

	it("retries a failed first load", async () => {
		const { user, drain } = await setup({
			...STATE,
			workspaces: [],
			status: { kind: "failed", error: "Deployment unreachable" },
		});
		const alert = screen.getByRole("alert");
		expect(alert).toHaveTextContent("Deployment unreachable");
		expect(
			screen.queryByRole("heading", { name: "No workspaces" }),
		).not.toBeInTheDocument();

		await user.click(within(alert).getByRole("button", { name: "Try again" }));
		expect(drain(WorkspacesApi.refresh.method)).toEqual([undefined]);
	});

	it("keeps each remaining row's expansion when a refresh adds and removes rows", async () => {
		const { user, drain } = await setup();
		await user.click(row("alpha"));
		await user.click(screen.getAllByRole("treeitem", { name: "Metadata" })[1]);
		expect(drain(WorkspacesApi.watchAgents.method)).toEqual([
			{ agentIds: ["agent-main"] },
		]);

		const gamma = workspace({
			id: "ws-gamma",
			name: "gamma",
			agents: [agent({ id: "agent-gamma", name: "gamma-main" })],
		});
		const alpha = workspace({
			id: ALPHA.id,
			name: "alpha",
			agents: [
				agent({ id: "agent-main", name: "main" }),
				agent({ id: "agent-dev", name: "dev", parent_id: "agent-main" }),
				agent({ id: "agent-new", name: "new" }),
			],
		});
		await pushState({ ...STATE, workspaces: [gamma, alpha] });

		expect(
			screen.queryByRole("treeitem", { name: "beta" }),
		).not.toBeInTheDocument();
		expect(row("gamma")).toHaveAttribute("aria-expanded", "false");
		expect(row("alpha")).toHaveAttribute("aria-expanded", "true");
		expect(row("main")).toHaveAttribute("aria-expanded", "true");
		expect(row("dev")).toHaveAttribute("aria-expanded", "true");
		expect(row("new")).toHaveAttribute("aria-expanded", "false");
		expect(
			screen
				.getAllByRole("treeitem", { name: "Metadata" })
				.map((item) => item.getAttribute("aria-expanded")),
		).toEqual(["false", "true"]);
		expect(drain(WorkspacesApi.watchAgents.method)).toEqual([]);
	});

	it("keeps the tree and its expansion while refreshing and after a failure", async () => {
		const { user, drain } = await setup();
		await user.click(row("alpha"));

		const listedAt = Date.parse("2024-01-01T14:05:00Z");
		const updated = `Updated ${format(listedAt, "p")}`;
		await pushState({ ...STATE, listedAt, status: { kind: "loading" } });
		expect(
			screen.getByRole("progressbar", { name: "Refreshing workspaces" }),
		).toBeInTheDocument();
		expect(row("main")).toBeInTheDocument();
		expect(screen.getByText(updated)).toBeInTheDocument();

		await pushState({
			...STATE,
			listedAt,
			status: { kind: "failed", error: "Timed out" },
		});
		expect(row("main")).toBeInTheDocument();
		expect(screen.queryByText(updated)).not.toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		const banner = screen.getByRole("status");
		expect(banner).toHaveTextContent(
			`Couldn't refresh. Showing results from ${format(listedAt, "p")}.Timed out`,
		);
		await user.click(within(banner).getByRole("button", { name: "Retry" }));
		expect(drain(WorkspacesApi.refresh.method)).toEqual([undefined]);
	});

	it.each(["hover", "keyboard"] as const)(
		"shows the full list time using $0",
		async (interaction) => {
			const { user } = await setup();
			const listedAt = Date.parse("2024-01-01T14:05:00Z");
			await pushState({ ...STATE, listedAt });

			const updated = screen.getByText(`Updated ${format(listedAt, "p")}`);
			if (interaction === "hover") {
				await user.hover(updated);
			} else {
				await user.tab();
				expect(
					screen.getByRole("button", { name: "Workspace filter: Mine" }),
				).toHaveFocus();
				await user.tab();
				expect(updated).toHaveFocus();
			}
			expect(await screen.findByRole("tooltip")).toHaveTextContent(
				formatISO(listedAt),
			);
		},
	);
});
