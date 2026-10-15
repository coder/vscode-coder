import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { agent, agentMetadata, app, appStatus, workspace } from "@repo/mocks";
import { WorkspacesApi, type WorkspacesState } from "@repo/shared";
import App from "@repo/workspaces/App";

// The webview may acquire the VS Code API once per page, so one stub serves
// every test and forwards to the sink the current test installed.
let sink: Array<{ method: string; params: unknown }> = [];
vi.stubGlobal("acquireVsCodeApi", () => ({
	postMessage: (message: { method: string; params: unknown }) =>
		sink.push(message),
	getState: () => undefined,
	setState: () => {},
}));

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
			apps: [app({ statuses: [appStatus()] })],
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

/** Push the state the way the extension does. */
const push = (state: WorkspacesState) =>
	act(async () => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: WorkspacesApi.stateChanged.method, data: state },
			}),
		);
		await Promise.resolve();
	});

async function setup(state: WorkspacesState | null = STATE) {
	const sent: typeof sink = [];
	sink = sent;
	const user = userEvent.setup();
	const view = render(<App />);
	if (state) {
		await push(state);
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

const row = (name: string) => screen.getByRole("treeitem", { name });
const metadataRows = () =>
	screen.getAllByRole("treeitem", { name: "Agent metadata" });
/** The row the tree's keyboard focus is on. */
const activeRow = () => {
	const id = screen.getByRole("tree").getAttribute("aria-activedescendant");
	return id ? document.getElementById(id) : null;
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
		await user.keyboard("{End}{Enter}");
		expect(drain(WorkspacesApi.setFilter.method)).toEqual([
			{ filter: "shared" },
		]);
		await push({ ...STATE, filter: "shared" });
		expect(
			screen.getByRole("button", { name: "Workspace filter: Shared" }),
		).toBeVisible();
	});

	it("shows owners only in All and Shared, including after filter changes", async () => {
		await setup();
		for (const filter of ["mine", "shared", "all", "mine"] as const) {
			await push({
				...STATE,
				capabilities: {
					authenticated: true,
					filters: ["mine", "shared", "all"],
				},
				filter,
			});
			const workspaceRow = row(filter === "mine" ? "alpha" : "alpha alice");
			if (filter === "mine") {
				expect(
					within(workspaceRow).queryByText("alice"),
				).not.toBeInTheDocument();
			} else {
				expect(within(workspaceRow).getByText("alice")).toBeVisible();
			}
		}
	});

	it.each(["starting", "stopped"] as const)(
		"shows %s despite health from a previous build",
		async (status) => {
			await setup({
				...STATE,
				workspaces: [
					workspace({
						latest_build: { status },
						health: { healthy: false, failing_agents: [] },
					}),
				],
			});
			expect(screen.getByRole("img", { name: status })).toBeInTheDocument();
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

	it("opens settings from the menu and disables actions it cannot run", async () => {
		const { user, drain } = await setup();
		await user.click(
			screen.getByRole("button", { name: "More actions for beta" }),
		);
		const menu = await screen.findByRole("menu");
		for (const name of [
			"Start",
			"Share",
			"Ping",
			"Speed Test",
			"Support Bundle",
			"Delete...",
		]) {
			expect(within(menu).getByRole("menuitem", { name })).toHaveAttribute(
				"aria-disabled",
				"true",
			);
		}
		await user.click(within(menu).getByRole("menuitem", { name: "Settings" }));
		expect(drain(WorkspacesApi.viewInDashboard.method)).toEqual([
			{ workspaceId: "ws-beta", page: "settings" },
		]);
	});

	it.each([
		["running", ["Stop", "Restart"]],
		["stopped", ["Start"]],
		["failed", ["Retry"]],
		["canceled", ["Retry"]],
		["starting", []],
		["stopping", []],
		["pending", []],
		["canceling", []],
		["deleting", []],
		["deleted", []],
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

	it("describes workspaces and agents through keyboard hover", async () => {
		const boxes = vi
			.spyOn(Element.prototype, "getBoundingClientRect")
			.mockReturnValue(DOMRect.fromRect({ width: 200, height: 22 }));
		onTestFinished(() => boxes.mockRestore());
		const { user } = await setup({
			...STATE,
			workspaces: [
				workspace({
					template_display_name: "Go",
					template_name: "go-template",
					agents: [agent({ name: "primary", status: "connecting" })],
				}),
			],
		});
		await user.click(row("test-workspace"));
		await user.keyboard("{Control>}k{/Control}{Control>}i{/Control}");
		expect(await screen.findByRole("tooltip")).toHaveTextContent(
			"Template: Go • Status: Running",
		);
		await user.keyboard("{Escape}");
		await user.click(row("primary"));
		await user.keyboard("{Control>}k{/Control}{Control>}i{/Control}");
		expect(await screen.findByRole("tooltip")).toHaveTextContent(
			"Status: connecting",
		);
	});

	it("watches metadata only for the agents whose metadata is visible", async () => {
		const { user, drain, unmount } = await setup();
		const watches = () => drain(WorkspacesApi.watchAgents.method);
		act(() => screen.getByRole("tree").focus());

		// Expanding a workspace opens its agents, the child under its parent.
		await user.keyboard("{ArrowRight}{ArrowRight}");
		expect(activeRow()).toBe(row("main"));
		expect(row("dev")).toHaveAttribute("aria-level", "3");
		expect(watches()).toEqual([]);

		// Below main: dev, dev's metadata, then main's metadata.
		await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}");
		expect(watches()).toEqual([{ agentIds: ["agent-main"] }]);
		expect(
			screen.getByRole("status", { name: "Loading metadata" }),
		).toBeInTheDocument();

		await push({
			...STATE,
			metadata: {
				"agent-main": { kind: "reported", metadata: [agentMetadata()] },
			},
		});
		expect(row("CPU: 42")).toBeInTheDocument();
		expect(watches()).toEqual([]);

		await user.keyboard("{ArrowUp}{ArrowRight}");
		expect(watches()).toEqual([{ agentIds: ["agent-dev", "agent-main"] }]);

		// Collapsing the parent agent hides both agents' metadata.
		await user.click(row("main"));
		expect(watches()).toEqual([{ agentIds: [] }]);
		await user.click(row("main"));
		expect(watches()).toEqual([{ agentIds: ["agent-dev", "agent-main"] }]);

		await user.click(row("alpha"));
		expect(watches()).toEqual([{ agentIds: [] }]);
		await user.click(row("alpha"));
		expect(metadataRows()).toHaveLength(2);
		expect(watches()).toEqual([{ agentIds: ["agent-dev", "agent-main"] }]);

		unmount();
		expect(watches()).toEqual([{ agentIds: [] }]);
	});

	it("describes reported metadata through keyboard hover", async () => {
		// jsdom has no layout, but tree hovers require a visible anchor.
		const boxes = vi
			.spyOn(Element.prototype, "getBoundingClientRect")
			.mockReturnValue(DOMRect.fromRect({ width: 200, height: 22 }));
		onTestFinished(() => boxes.mockRestore());
		const { user } = await setup({
			...STATE,
			workspaces: [workspace({ agents: [agent()] })],
			metadata: {
				"agent-1": { kind: "reported", metadata: [agentMetadata()] },
			},
		});
		await user.click(row("test-workspace"));
		await user.click(row("Agent metadata"));
		await user.click(row("CPU: 42"));
		await user.keyboard("{Control>}k{/Control}{Control>}i{/Control}");
		const tooltip = await screen.findByRole("tooltip");
		expect(tooltip).toHaveTextContent("CPU: 42");
		expect(tooltip).toHaveTextContent("Collected at 2024-01-01T00:00:00Z");
	});

	it("lists an agent's app statuses under the agent", async () => {
		const { user } = await setup();
		await user.click(row("beta"));
		expect(row("Claude Code: Running tests")).toHaveAttribute(
			"aria-level",
			"3",
		);
	});

	it("explains when an expanded workspace has no agents", async () => {
		const { user } = await setup({
			...STATE,
			workspaces: [workspace({ name: "empty", owner_name: "alice" })],
		});
		await user.click(row("empty"));
		expect(row("No agents available")).toBeInTheDocument();
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
		{
			name: "a signed out session",
			state: {
				...STATE,
				workspaces: [],
				capabilities: { authenticated: false, filters: [] },
			},
			visible: { role: "heading", name: "Welcome to Coder" },
		},
	])("shows $name", async ({ state, visible }) => {
		await setup(state);
		expect(
			screen.getByRole(visible.role, { name: visible.name }),
		).toBeVisible();
		expect(screen.queryByRole("tree")).not.toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		if (state && !state.capabilities.authenticated) {
			expect(
				screen.queryByRole("button", { name: /^Workspace filter:/ }),
			).not.toBeInTheDocument();
		}
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

	it("keeps the tree and its expansion while refreshing or after a failure", async () => {
		const { user } = await setup();
		await user.click(row("alpha"));

		await push({ ...STATE, status: { kind: "loading" } });
		expect(
			screen.getByRole("progressbar", { name: "Refreshing workspaces" }),
		).toBeInTheDocument();
		expect(row("main")).toBeInTheDocument();

		await push({ ...STATE, status: { kind: "failed", error: "Timed out" } });
		expect(screen.getByRole("alert")).toHaveTextContent("Timed out");
		expect(row("main")).toBeInTheDocument();
	});
});
