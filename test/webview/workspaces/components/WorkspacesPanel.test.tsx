import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	agent,
	agentMetadata,
	app,
	appStatus,
	workspace,
	workspacesState,
} from "@repo/mocks";
import {
	WorkspacesApi,
	type WorkspacesState,
	type WorkspaceStatus,
} from "@repo/shared";

import {
	activeRow,
	row,
	stubElementBoxes,
} from "../../ui/components/Tree/treeTestHelpers";
import { pushState, renderApp } from "../ipc";

import type { UserEvent } from "@testing-library/user-event";

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

const STATE = workspacesState({ workspaces: [ALPHA, BETA] });

const SIGNED_OUT = workspacesState({
	capabilities: { authenticated: false, filters: [] },
});

const setup = (state: WorkspacesState | null = STATE) => renderApp(state);

const hoverDetails = (tooltip: HTMLElement) =>
	within(tooltip)
		.getAllByRole("term")
		.map((term) => [term.textContent, term.nextElementSibling?.textContent]);

/** Show the focused row's hover, as Ctrl+K Ctrl+I does in VS Code. */
const showHover = async (user: UserEvent) => {
	await user.keyboard("{Control>}k{/Control}{Control>}i{/Control}");
	return screen.findByRole("tooltip");
};

afterEach(() => {
	vi.useRealTimers();
});

describe("WorkspacesPanel", () => {
	it.each([{ workspaces: [] }, { workspaces: [ALPHA] }])(
		"advances the Shared list age without another state push ($workspaces.length rows)",
		async ({ workspaces }) => {
			vi.useFakeTimers({
				now: new Date("2024-06-15T12:00:30Z"),
				toFake: ["Date", "setInterval", "clearInterval"],
			});
			const listedAtMs = Date.now();
			const { unmount } = await setup({
				...STATE,
				filter: "shared",
				workspaces,
				listedAtMs,
			});
			expect(screen.getByText("a few seconds ago")).toBeVisible();
			await act(() => vi.advanceTimersByTimeAsync(44_000));
			expect(screen.getByText("a few seconds ago")).toBeVisible();
			await act(() => vi.advanceTimersByTimeAsync(1_000));
			expect(screen.getByText("a minute ago")).toBeVisible();
			await act(() => vi.advanceTimersByTimeAsync(45_000));
			expect(screen.getByText("2 minutes ago")).toBeVisible();
			await pushState({
				...STATE,
				filter: "shared",
				workspaces,
				listedAtMs: Date.now(),
			});
			expect(screen.getByText("a few seconds ago")).toBeVisible();
			unmount();
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it("shows when the list arrived in full on hover", async () => {
		vi.useFakeTimers({
			now: new Date("2024-06-15T12:00:30Z"),
			toFake: ["Date"],
		});
		const { user } = await setup(
			workspacesState({ filter: "shared", listedAtMs: Date.now() }),
		);
		const time = screen.getByText("a few seconds ago");
		expect(time).toHaveAttribute("datetime", "2024-06-15T12:00:30.000Z");
		await user.hover(time);
		expect(await screen.findByRole("tooltip")).toHaveTextContent(/2024.*30/);
	});

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

	interface HealthCase {
		status: WorkspaceStatus;
		label: string;
	}
	it.each<HealthCase>([
		{ status: "starting", label: "Starting" },
		{ status: "stopped", label: "Stopped" },
	])(
		"shows $status despite health from a previous build",
		async ({ status, label }) => {
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
		await setup({ ...STATE, chatWorkspaceIds: [ALPHA.id] });
		expect(
			within(row("alpha Agent")).getByText("Agent", { exact: true }),
		).toBeVisible();
		expect(
			within(row("beta")).queryByText("Agent", { exact: true }),
		).not.toBeInTheDocument();
	});

	it("sends row and menu actions for their own row without toggling it", async () => {
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
		await user.click(
			screen.getByRole("button", { name: "More actions for beta" }),
		);
		const menu = await screen.findByRole("menu");
		await user.click(within(menu).getByRole("menuitem", { name: "Settings" }));
		expect(drain(WorkspacesApi.viewInDashboard.method)).toEqual([
			{ workspaceId: "ws-alpha", page: "workspace" },
			{ workspaceId: "ws-beta", page: "settings" },
		]);
	});

	interface LifecycleCase {
		status: WorkspaceStatus;
		actions: string[];
	}
	it.each<LifecycleCase>([
		{ status: "running", actions: ["Stop", "Restart"] },
		{ status: "stopped", actions: ["Start"] },
		{ status: "canceled", actions: ["Retry"] },
		{ status: "starting", actions: [] },
	])(
		"leads the menu with lifecycle actions for $status",
		async ({ status, actions }) => {
			const { user } = await setup({
				...STATE,
				workspaces: [workspace({ latest_build: { status } })],
			});
			await user.click(
				screen.getByRole("button", { name: "More actions for test-workspace" }),
			);
			const names = within(await screen.findByRole("menu"))
				.getAllByRole("menuitem")
				.map((item) => item.textContent);
			expect(names.slice(0, names.indexOf("Share"))).toEqual(actions);
		},
	);

	it("describes workspaces, workspace agents and metadata on hover", async () => {
		stubElementBoxes();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime("2024-01-01T00:00:05Z");
		const { user } = await setup({
			...STATE,
			filter: "all",
			chatWorkspaceIds: ["workspace-1"],
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
		const { user, drain, unmount } = await setup();
		const watches = () => drain(WorkspacesApi.watchAgents.method);
		act(() => screen.getByRole("tree").focus());

		await user.keyboard("{ArrowRight}{ArrowRight}");
		expect(activeRow()).toBe("main");
		expect(row("dev")).toHaveAttribute("aria-level", "3");
		expect(watches()).toEqual([{ agentIds: [] }]);

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
		await user.click(row("alpha"));
		expect(watches()).toEqual([{ agentIds: ["agent-dev", "agent-main"] }]);
		unmount();
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

	interface PlaceholderCase {
		name: string;
		state: WorkspacesState | null;
		visible: { role: string; name: string };
	}
	it.each<PlaceholderCase>([
		{
			name: "loading before the first state",
			state: null,
			visible: { role: "status", name: "Loading workspaces" },
		},
		{
			name: "loading the first list",
			state: workspacesState({ status: { kind: "loading" } }),
			visible: { role: "status", name: "Loading workspaces" },
		},
		{
			name: "an empty list",
			state: workspacesState(),
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
		const { user, drain } = await setup(
			workspacesState({
				status: { kind: "failed", error: "Deployment unreachable" },
			}),
		);
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
		const watches = () => drain(WorkspacesApi.watchAgents.method);
		expect(watches()).toEqual([{ agentIds: [] }, { agentIds: ["agent-main"] }]);

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

		await pushState(workspacesState({ status: { kind: "loading" } }));
		expect(screen.queryByRole("tree")).not.toBeInTheDocument();
		await pushState({ ...STATE, workspaces: [gamma, alpha] });
		expect(row("alpha")).toHaveAttribute("aria-expanded", "true");
		expect(row("main")).toHaveAttribute("aria-expanded", "true");
		// The store matches watches against each list, so pushes send none.
		expect(watches()).toEqual([]);
	});

	it("keeps the tree and its expansion while refreshing and after a failure", async () => {
		vi.useFakeTimers({
			now: new Date("2024-06-15T12:00:00Z"),
			toFake: ["Date", "setInterval", "clearInterval"],
		});
		const { user, drain } = await setup();
		await user.click(row("alpha"));

		const listedAtMs = Date.now() - 5 * 60_000;
		await pushState({ ...STATE, listedAtMs, status: { kind: "loading" } });
		expect(
			screen.getByRole("progressbar", { name: "Refreshing workspaces" }),
		).toBeInTheDocument();
		expect(row("main")).toBeInTheDocument();
		expect(screen.getByText("5 minutes ago")).toBeInTheDocument();

		await pushState({
			...STATE,
			listedAtMs,
			status: { kind: "failed", error: "Timed out" },
		});
		expect(row("main")).toBeInTheDocument();
		expect(screen.queryByText(/^Updated/)).not.toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		const banner = screen.getByRole("status");
		expect(banner).toHaveTextContent(
			"Couldn't refresh. Showing results from 5 minutes ago. Timed out",
		);
		await act(() => vi.advanceTimersByTimeAsync(45_000));
		expect(banner).toHaveTextContent("Showing results from 6 minutes ago.");
		expect(row("main")).toBeInTheDocument();
		await user.click(within(banner).getByRole("button", { name: "Retry" }));
		expect(drain(WorkspacesApi.refresh.method)).toEqual([undefined]);
	});
});
