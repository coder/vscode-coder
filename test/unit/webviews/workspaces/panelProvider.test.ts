import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { agent, workspace } from "@repo/mocks";
import { WorkspacesApi, type OpenWorkspaceParams } from "@repo/shared";

import {
	MockConfigurationProvider,
	setActiveColorTheme,
} from "../../../mocks/testHelpers";

import { createPanel, DEPLOYMENT_URL, disposeHarnesses } from "./harness";

/** A workspace of "alice" with a single "main" agent. */
const aliceWorkspace = () =>
	workspace({
		id: "workspace-1",
		name: "dev",
		owner_name: "alice",
		agents: [agent({ id: "agent-1", name: "main" })],
	});

describe("WorkspacesPanelProvider", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		new MockConfigurationProvider();
	});

	afterEach(() => {
		disposeHarnesses();
	});

	it("renders the workspaces bundle", () => {
		const h = createPanel();

		expect(h.view.webview.html).toContain("Coder Workspaces");
		expect(h.view.webview.options.enableScripts).toBe(true);
	});

	it("replays the whole state when the webview signals ready", async () => {
		const h = createPanel();
		h.client.respondOnce([aliceWorkspace()]);
		await h.show();
		h.clearPushes();

		await h.send(WorkspacesApi.ready);

		expect(h.pushedUpdates()).toEqual([
			{
				capabilities: { authenticated: true, filters: ["mine", "shared"] },
				workspaces: {
					filter: "mine",
					workspaces: [expect.objectContaining({ id: "workspace-1" })],
					loading: false,
				},
				metadata: {},
				error: null,
			},
		]);
	});

	it("pushes one update carrying only the fields that changed", async () => {
		const h = createPanel();
		await h.show();
		h.clearPushes();
		h.client.respondOnce([aliceWorkspace()]);

		await h.send(WorkspacesApi.refresh);

		const updates = h.pushedUpdates();
		expect(updates.map(Object.keys)).toEqual([["workspaces"], ["workspaces"]]);
		expect(updates.at(-1)?.workspaces?.workspaces).toHaveLength(1);
	});

	it("pushes fresh workspaces on reveal without resending the rest", async () => {
		const h = createPanel();
		await h.show();
		h.setVisible(false);
		h.clearPushes();
		h.client.respondOnce([aliceWorkspace()]);

		h.setVisible(true);
		await h.store.settled;

		expect(h.pushedUpdates()).toEqual([
			{
				workspaces: {
					filter: "mine",
					workspaces: [expect.objectContaining({ id: "workspace-1" })],
					loading: false,
				},
			},
		]);
	});

	it("pushes nothing when the color theme changes", async () => {
		const h = createPanel();
		await h.show();
		h.clearPushes();

		setActiveColorTheme(vscode.ColorThemeKind.Light);

		expect(h.pushedUpdates()).toEqual([]);
	});

	it("pushes nothing once disposed", async () => {
		const h = createPanel();
		await h.show();
		h.provider.dispose();
		h.clearPushes();

		h.setVisible(true);
		await h.store.settled;

		expect(h.pushedUpdates()).toEqual([]);
	});

	it("ignores an unrecognized message", async () => {
		const h = createPanel();
		await h.show();
		h.clearPushes();

		await h.sendRaw({ method: "nope" });

		expect(h.pushedUpdates()).toEqual([]);
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
	});

	describe("commands", () => {
		it("switches the filter", async () => {
			const h = createPanel();
			await h.show();

			await h.send(WorkspacesApi.setFilter, { filter: "shared" });

			expect(h.store.state.workspaces.filter).toBe("shared");
		});

		it("watches the agents the webview is showing", async () => {
			const h = createPanel();
			h.client.respondOnce([aliceWorkspace()]);
			await h.show();

			await h.send(WorkspacesApi.watchAgents, { agentIds: ["agent-1"] });

			expect([...h.client.metadataStreams.keys()]).toEqual(["agent-1"]);
		});
	});

	describe("openWorkspace", () => {
		it.each<{ name: string; params: OpenWorkspaceParams; agent?: string }>([
			{ name: "the workspace", params: { workspaceId: "workspace-1" } },
			{
				name: "one of its agents",
				params: { workspaceId: "workspace-1", agentId: "agent-1" },
				agent: "main",
			},
		])("opens $name", async ({ params, agent: agentName }) => {
			const h = createPanel();
			h.client.respondOnce([aliceWorkspace()]);
			await h.show();

			await h.send(WorkspacesApi.openWorkspace, params);

			expect(h.openWorkspace).toHaveBeenCalledWith(
				expect.objectContaining({ name: "dev", owner_name: "alice" }),
				agentName ? expect.objectContaining({ name: agentName }) : undefined,
			);
		});

		interface FailureCase {
			name: string;
			params: OpenWorkspaceParams;
			refuse?: boolean;
			reported: string;
		}

		it.each<FailureCase>([
			{
				name: "a workspace that is gone",
				params: { workspaceId: "gone" },
				reported: "Workspace is no longer available",
			},
			{
				name: "an agent that is gone",
				params: { workspaceId: "workspace-1", agentId: "gone" },
				reported: "Agent is no longer available",
			},
			{
				name: "a connection that failed",
				params: { workspaceId: "workspace-1" },
				refuse: true,
				reported: "no SSH binary",
			},
		])("reports $name", async ({ params, refuse, reported }) => {
			const h = createPanel();
			h.client.respondOnce([aliceWorkspace()]);
			await h.show();
			if (refuse) {
				h.openWorkspace.mockRejectedValueOnce(new Error(reported));
			}

			await h.send(WorkspacesApi.openWorkspace, params);

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(reported);
		});
	});

	describe("viewInDashboard", () => {
		it.each([
			{ page: "workspace", url: `${DEPLOYMENT_URL}/@alice/dev` },
			{ page: "settings", url: `${DEPLOYMENT_URL}/@alice/dev/settings` },
		] as const)(
			"opens the $page page in the browser",
			async ({ page, url }) => {
				const h = createPanel();
				h.client.respondOnce([aliceWorkspace()]);
				await h.show();

				await h.send(WorkspacesApi.viewInDashboard, {
					workspaceId: "workspace-1",
					page,
				});

				expect(vscode.env.openExternal).toHaveBeenCalledWith(
					vscode.Uri.parse(url),
				);
			},
		);

		it("opens nothing while signed out of every deployment", async () => {
			const h = createPanel();
			h.client.respondOnce([aliceWorkspace()]);
			await h.show();
			h.client.getHost.mockReturnValue(undefined);

			await h.send(WorkspacesApi.viewInDashboard, {
				workspaceId: "workspace-1",
				page: "settings",
			});

			expect(vscode.env.openExternal).not.toHaveBeenCalled();
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		});

		it("reports a workspace that is no longer listed", async () => {
			const h = createPanel();
			await h.show();

			await h.send(WorkspacesApi.viewInDashboard, {
				workspaceId: "gone",
				page: "settings",
			});

			expect(vscode.env.openExternal).not.toHaveBeenCalled();
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Workspace is no longer available",
			);
		});
	});
});
