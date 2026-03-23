import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { WorkspaceMonitor } from "@/workspace/workspaceMonitor";

import {
	MockConfigurationProvider,
	MockContextManager,
	MockEventStream,
	MockStatusBar,
	createMockLogger,
} from "../../mocks/testHelpers";
import { workspace as createWorkspace } from "../../mocks/workspace";

import type {
	ServerSentEvent,
	Workspace,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";
import type { ContextManager } from "@/core/contextManager";

function workspaceEvent(
	overrides?: Parameters<typeof createWorkspace>[0],
): ServerSentEvent {
	return { type: "data", data: createWorkspace(overrides) };
}

function minutesFromNow(n: number): string {
	return new Date(Date.now() + n * 60_000).toISOString();
}

describe("WorkspaceMonitor", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	async function setup(stream = new MockEventStream<ServerSentEvent>()) {
		const config = new MockConfigurationProvider();
		const statusBar = new MockStatusBar();
		const contextManager = new MockContextManager();
		const client = {
			watchWorkspace: vi.fn().mockResolvedValue(stream),
			getTemplate: vi.fn().mockResolvedValue({
				active_version_id: "version-2",
			}),
			getTemplateVersion: vi.fn().mockResolvedValue({
				message: "template v2",
			}),
		} as unknown as CoderApi;
		const monitor = await WorkspaceMonitor.create(
			createWorkspace(),
			client,
			createMockLogger(),
			contextManager as unknown as ContextManager,
		);
		return { monitor, client, stream, config, statusBar, contextManager };
	}

	describe("websocket lifecycle", () => {
		it("fires onChange when a workspace message arrives", async () => {
			const { monitor, stream } = await setup();
			const changes: Workspace[] = [];
			monitor.onChange.event((ws) => changes.push(ws));

			stream.pushMessage(workspaceEvent({ outdated: true }));

			expect(changes).toHaveLength(1);
			expect(changes[0].outdated).toBe(true);
		});

		it("logs parse errors without showing notifications", async () => {
			const { stream } = await setup();

			stream.pushError(new Error("bad json"));

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		});

		it("closes the socket on dispose", async () => {
			const stream = new MockEventStream<ServerSentEvent>();
			const { monitor } = await setup(stream);

			monitor.dispose();

			expect(stream.close).toHaveBeenCalled();
		});
	});

	describe("context and status bar", () => {
		it("sets coder.workspace.updatable context when workspace is outdated", async () => {
			const { stream, contextManager } = await setup();

			stream.pushMessage(workspaceEvent({ outdated: true }));

			expect(contextManager.get("coder.workspace.updatable")).toBe(true);
		});

		it("shows status bar when outdated, hides when not", async () => {
			const { stream, statusBar } = await setup();

			stream.pushMessage(workspaceEvent({ outdated: true }));
			expect(statusBar.show).toHaveBeenCalled();

			stream.pushMessage(workspaceEvent({ outdated: false }));
			expect(statusBar.hide).toHaveBeenCalled();
		});
	});

	describe("notifications", () => {
		it("shows autostop notification when deadline is impending", async () => {
			const { stream } = await setup();

			stream.pushMessage(
				workspaceEvent({
					latest_build: {
						status: "running",
						deadline: minutesFromNow(15),
					},
				}),
			);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("scheduled to shut down"),
			);
		});

		it("shows deletion notification when deletion is impending", async () => {
			const { monitor, stream } = await setup();
			monitor.markInitialSetupComplete();

			stream.pushMessage(
				workspaceEvent({ deleting_at: minutesFromNow(12 * 60) }),
			);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("scheduled for deletion"),
			);
		});

		it("shows not-running notification after initial setup", async () => {
			const { monitor, stream } = await setup();
			monitor.markInitialSetupComplete();

			stream.pushMessage(
				workspaceEvent({ latest_build: { status: "stopped" } }),
			);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("no longer running"),
				expect.anything(),
				expect.anything(),
			);
		});

		it("does not show deletion or not-running notifications before initial setup", async () => {
			const { stream } = await setup();

			stream.pushMessage(
				workspaceEvent({ deleting_at: minutesFromNow(12 * 60) }),
			);
			stream.pushMessage(
				workspaceEvent({ latest_build: { status: "stopped" } }),
			);

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		});

		it("fetches template details for outdated notification", async () => {
			const { stream } = await setup();

			stream.pushMessage(workspaceEvent({ outdated: true }));

			await vi.waitFor(() => {
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
					expect.stringContaining("template v2"),
					"Update",
				);
			});
		});

		it("only notifies once per event type", async () => {
			const { stream } = await setup();

			const event = workspaceEvent({
				latest_build: {
					status: "running",
					deadline: minutesFromNow(15),
				},
			});
			stream.pushMessage(event);
			stream.pushMessage(event);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
		});
	});

	describe("disableUpdateNotifications", () => {
		it("suppresses outdated notification but allows other types", async () => {
			const { stream, client, config } = await setup();
			config.set("coder.disableUpdateNotifications", true);

			stream.pushMessage(workspaceEvent({ outdated: true }));
			expect(client.getTemplate).not.toHaveBeenCalled();

			stream.pushMessage(
				workspaceEvent({
					latest_build: {
						status: "running",
						deadline: minutesFromNow(15),
					},
				}),
			);
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("scheduled to shut down"),
			);
		});

		it("shows outdated notification after re-enabling", async () => {
			const { stream, config } = await setup();
			config.set("coder.disableUpdateNotifications", true);

			stream.pushMessage(workspaceEvent({ outdated: true }));

			config.set("coder.disableUpdateNotifications", false);

			stream.pushMessage(workspaceEvent({ outdated: true }));
			await vi.waitFor(() => {
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
					expect.stringContaining("template v2"),
					"Update",
				);
			});
		});
	});

	describe("disableNotifications", () => {
		it("suppresses all notification types", async () => {
			const { monitor, stream, config } = await setup();
			config.set("coder.disableNotifications", true);
			monitor.markInitialSetupComplete();

			stream.pushMessage(workspaceEvent({ outdated: true }));
			stream.pushMessage(
				workspaceEvent({
					latest_build: {
						status: "running",
						deadline: minutesFromNow(15),
					},
				}),
			);
			stream.pushMessage(
				workspaceEvent({ deleting_at: minutesFromNow(12 * 60) }),
			);
			stream.pushMessage(
				workspaceEvent({ latest_build: { status: "stopped" } }),
			);

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		});

		it("still updates context and status bar", async () => {
			const { stream, config, contextManager, statusBar } = await setup();
			config.set("coder.disableNotifications", true);

			stream.pushMessage(workspaceEvent({ outdated: true }));

			expect(contextManager.get("coder.workspace.updatable")).toBe(true);
			expect(statusBar.show).toHaveBeenCalled();
		});

		it("still fires onChange events", async () => {
			const { monitor, stream, config } = await setup();
			config.set("coder.disableNotifications", true);
			const changes: Workspace[] = [];
			monitor.onChange.event((ws) => changes.push(ws));

			stream.pushMessage(workspaceEvent({ outdated: true }));

			expect(changes).toHaveLength(1);
		});

		it("shows notifications after re-enabling", async () => {
			const { stream, config } = await setup();
			config.set("coder.disableNotifications", true);

			stream.pushMessage(
				workspaceEvent({
					latest_build: {
						status: "running",
						deadline: minutesFromNow(15),
					},
				}),
			);
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

			config.set("coder.disableNotifications", false);

			stream.pushMessage(
				workspaceEvent({
					latest_build: {
						status: "running",
						deadline: minutesFromNow(15),
					},
				}),
			);
			expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
		});
	});
});
