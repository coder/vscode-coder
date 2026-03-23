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

function createMockClient(stream: MockEventStream<ServerSentEvent>) {
	return {
		watchWorkspace: vi.fn().mockResolvedValue(stream.stream),
		getTemplate: vi.fn().mockResolvedValue({
			active_version_id: "version-2",
		}),
		getTemplateVersion: vi.fn().mockResolvedValue({
			message: "template v2",
		}),
	} as unknown as CoderApi;
}

function workspaceEvent(ws: Workspace): ServerSentEvent {
	return { type: "data", data: ws };
}

describe("WorkspaceMonitor", () => {
	let config: MockConfigurationProvider;
	let statusBar: MockStatusBar;
	let contextManager: MockContextManager;

	beforeEach(() => {
		vi.resetAllMocks();
		config = new MockConfigurationProvider();
		statusBar = new MockStatusBar();
		contextManager = new MockContextManager();
	});

	async function createMonitor(
		ws: Workspace = createWorkspace(),
		stream = new MockEventStream<ServerSentEvent>(),
	) {
		const client = createMockClient(stream);
		const monitor = await WorkspaceMonitor.create(
			ws,
			client,
			createMockLogger(),
			contextManager as unknown as import("@/core/contextManager").ContextManager,
		);
		return { monitor, client, stream };
	}

	describe("websocket lifecycle", () => {
		it("fires onChange when a workspace message arrives", async () => {
			const { monitor, stream } = await createMonitor();
			const changes: Workspace[] = [];
			monitor.onChange.event((ws) => changes.push(ws));

			const updated = createWorkspace({ outdated: true });
			stream.pushMessage(workspaceEvent(updated));

			expect(changes).toHaveLength(1);
			expect(changes[0].outdated).toBe(true);
			monitor.dispose();
		});

		it("logs parse errors without showing notifications", async () => {
			const { monitor, stream } = await createMonitor();
			stream.pushError(new Error("bad json"));

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
			monitor.dispose();
		});

		it("closes the socket on dispose", async () => {
			const stream = new MockEventStream<ServerSentEvent>();
			const { monitor } = await createMonitor(createWorkspace(), stream);
			monitor.dispose();

			expect(stream.stream.close).toHaveBeenCalled();
		});
	});

	describe("context and status bar", () => {
		it("sets coder.workspace.updatable context when workspace is outdated", async () => {
			const { monitor, stream } = await createMonitor();

			stream.pushMessage(workspaceEvent(createWorkspace({ outdated: true })));

			expect(contextManager.set).toHaveBeenCalledWith(
				"coder.workspace.updatable",
				true,
			);
			monitor.dispose();
		});

		it("shows status bar when outdated, hides when not", async () => {
			const { monitor, stream } = await createMonitor();

			stream.pushMessage(workspaceEvent(createWorkspace({ outdated: true })));
			expect(statusBar.show).toHaveBeenCalled();

			stream.pushMessage(workspaceEvent(createWorkspace({ outdated: false })));
			expect(statusBar.hide).toHaveBeenCalled();

			monitor.dispose();
		});
	});

	describe("notifications when enabled", () => {
		it("shows autostop notification when deadline is impending", async () => {
			const deadline = new Date(Date.now() + 1000 * 60 * 15).toISOString();
			const { monitor, stream } = await createMonitor();
			monitor.markInitialSetupComplete();

			stream.pushMessage(
				workspaceEvent(
					createWorkspace({
						latest_build: { status: "running", deadline },
					}),
				),
			);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("scheduled to shut down"),
			);
			monitor.dispose();
		});

		it("shows deletion notification when deletion is impending", async () => {
			const deletingAt = new Date(
				Date.now() + 1000 * 60 * 60 * 12,
			).toISOString();
			const { monitor, stream } = await createMonitor();
			monitor.markInitialSetupComplete();

			stream.pushMessage(
				workspaceEvent(createWorkspace({ deleting_at: deletingAt })),
			);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("scheduled for deletion"),
			);
			monitor.dispose();
		});

		it("shows not-running notification after initial setup", async () => {
			const { monitor, stream } = await createMonitor();
			monitor.markInitialSetupComplete();

			stream.pushMessage(
				workspaceEvent(
					createWorkspace({ latest_build: { status: "stopped" } }),
				),
			);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("no longer running"),
				expect.anything(),
				expect.anything(),
			);
			monitor.dispose();
		});

		it("does not show not-running notification before initial setup", async () => {
			const { monitor, stream } = await createMonitor();

			stream.pushMessage(
				workspaceEvent(
					createWorkspace({ latest_build: { status: "stopped" } }),
				),
			);

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
			monitor.dispose();
		});

		it("does not show deletion notification before initial setup", async () => {
			const deletingAt = new Date(
				Date.now() + 1000 * 60 * 60 * 12,
			).toISOString();
			const { monitor, stream } = await createMonitor();

			stream.pushMessage(
				workspaceEvent(createWorkspace({ deleting_at: deletingAt })),
			);

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
			monitor.dispose();
		});

		it("shows outdated notification and fetches template details", async () => {
			const { monitor, stream, client } = await createMonitor();
			monitor.markInitialSetupComplete();

			stream.pushMessage(workspaceEvent(createWorkspace({ outdated: true })));

			await vi.waitFor(() => {
				expect(client.getTemplate).toHaveBeenCalledWith("template-1");
				expect(client.getTemplateVersion).toHaveBeenCalledWith("version-2");
				expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
					expect.stringContaining("template v2"),
					"Update",
				);
			});
			monitor.dispose();
		});

		it("only notifies once per event type", async () => {
			const deadline = new Date(Date.now() + 1000 * 60 * 15).toISOString();
			const { monitor, stream } = await createMonitor();
			monitor.markInitialSetupComplete();

			const ws = createWorkspace({
				latest_build: { status: "running", deadline },
			});
			stream.pushMessage(workspaceEvent(ws));
			stream.pushMessage(workspaceEvent(ws));

			expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
			monitor.dispose();
		});
	});

	describe("disableUpdateNotifications", () => {
		it("suppresses outdated notification but allows other notifications", async () => {
			config.set("coder.disableUpdateNotifications", true);
			const deadline = new Date(Date.now() + 1000 * 60 * 15).toISOString();
			const { monitor, stream, client } = await createMonitor();
			monitor.markInitialSetupComplete();

			stream.pushMessage(workspaceEvent(createWorkspace({ outdated: true })));
			expect(client.getTemplate).not.toHaveBeenCalled();

			stream.pushMessage(
				workspaceEvent(
					createWorkspace({
						latest_build: { status: "running", deadline },
					}),
				),
			);
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("scheduled to shut down"),
			);
			monitor.dispose();
		});

		it("shows outdated notification after re-enabling", async () => {
			config.set("coder.disableUpdateNotifications", true);
			const { monitor, stream, client } = await createMonitor();
			monitor.markInitialSetupComplete();

			stream.pushMessage(workspaceEvent(createWorkspace({ outdated: true })));
			expect(client.getTemplate).not.toHaveBeenCalled();

			config.set("coder.disableUpdateNotifications", false);

			stream.pushMessage(workspaceEvent(createWorkspace({ outdated: true })));

			await vi.waitFor(() => {
				expect(client.getTemplate).toHaveBeenCalled();
			});
			monitor.dispose();
		});
	});

	describe("disableNotifications", () => {
		beforeEach(() => {
			config.set("coder.disableNotifications", true);
		});

		it("suppresses all notification types", async () => {
			const deadline = new Date(Date.now() + 1000 * 60 * 15).toISOString();
			const deletingAt = new Date(
				Date.now() + 1000 * 60 * 60 * 12,
			).toISOString();
			const { monitor, stream } = await createMonitor();
			monitor.markInitialSetupComplete();

			stream.pushMessage(workspaceEvent(createWorkspace({ outdated: true })));
			stream.pushMessage(
				workspaceEvent(
					createWorkspace({
						latest_build: { status: "running", deadline },
					}),
				),
			);
			stream.pushMessage(
				workspaceEvent(createWorkspace({ deleting_at: deletingAt })),
			);
			stream.pushMessage(
				workspaceEvent(
					createWorkspace({ latest_build: { status: "stopped" } }),
				),
			);

			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
			monitor.dispose();
		});

		it("still updates context and status bar", async () => {
			const { monitor, stream } = await createMonitor();

			stream.pushMessage(workspaceEvent(createWorkspace({ outdated: true })));

			expect(contextManager.set).toHaveBeenCalledWith(
				"coder.workspace.updatable",
				true,
			);
			expect(statusBar.show).toHaveBeenCalled();
			monitor.dispose();
		});

		it("still fires onChange events", async () => {
			const { monitor, stream } = await createMonitor();
			const changes: Workspace[] = [];
			monitor.onChange.event((ws) => changes.push(ws));

			stream.pushMessage(workspaceEvent(createWorkspace({ outdated: true })));

			expect(changes).toHaveLength(1);
			monitor.dispose();
		});

		it("shows notifications after re-enabling", async () => {
			const deadline = new Date(Date.now() + 1000 * 60 * 15).toISOString();
			const { monitor, stream } = await createMonitor();
			monitor.markInitialSetupComplete();

			stream.pushMessage(
				workspaceEvent(
					createWorkspace({
						latest_build: { status: "running", deadline },
					}),
				),
			);
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();

			config.set("coder.disableNotifications", false);

			stream.pushMessage(
				workspaceEvent(
					createWorkspace({
						latest_build: { status: "running", deadline },
					}),
				),
			);
			expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
			monitor.dispose();
		});
	});
});
