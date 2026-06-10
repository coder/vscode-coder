import { describe, expect, it } from "vitest";

import { WorkspaceOpenTelemetry } from "@/instrumentation/workspaceOpen";

import { agent, resource, workspace } from "@repo/mocks";

import { createTelemetryHarness } from "../../mocks/telemetry";

function setup() {
	const { sink, service } = createTelemetryHarness();
	return { sink, telemetry: new WorkspaceOpenTelemetry(service) };
}

function workspaceWithAgents() {
	const connected = agent({
		status: "connected",
		lifecycle_state: "ready",
	});
	const disconnected = agent({
		id: "agent-2",
		name: "secondary",
		status: "disconnected",
		lifecycle_state: "off",
	});
	return {
		connected,
		disconnected,
		workspace: workspace({
			outdated: true,
			latest_build: {
				status: "running",
				resources: [resource({ agents: [connected, disconnected] })],
			},
		}),
	};
}

describe("WorkspaceOpenTelemetry", () => {
	it("records workspace selection without workspace or agent names", async () => {
		const { sink, telemetry } = setup();
		const selection = workspaceWithAgents();

		await telemetry.traceOpen(
			"command",
			{ workspace: selection.workspace, agent: selection.connected },
			() => Promise.resolve(true),
		);

		const event = sink.expectOne("workspace.open");
		expect(event.properties).toMatchObject({
			agent_lifecycle_state: "ready",
			agent_status: "connected",
			workspace_outdated: "true",
			workspace_status: "running",
			result: "success",
		});
		expect(event.measurements).toMatchObject({
			agent_count: 2,
			connected_agent_count: 1,
		});
		expect(event.properties.workspaceName).toBeUndefined();
		expect(event.properties.agentName).toBeUndefined();
	});

	it("records workspace picker cancellation and failure distinctly", async () => {
		const { sink, telemetry } = setup();

		await telemetry.tracePicker("workspace_open", (trace) => {
			const result = { status: "cancelled" } as const;
			trace.finish(result, 3);
			return Promise.resolve(result);
		});
		await telemetry.tracePicker("workspace_open", (trace) => {
			const result = { status: "failed", category: "fetch_failed" } as const;
			trace.finish(result, 0);
			return Promise.resolve(result);
		});

		const [cancelled, failed] = sink.eventsNamed("workspace.picker.prompted");
		expect(cancelled.properties).toMatchObject({ result: "aborted" });
		expect(cancelled.measurements.workspace_count).toBe(3);
		expect(failed.properties).toMatchObject({
			failure_category: "fetch_failed",
			result: "error",
		});
		expect(failed.measurements.workspace_count).toBe(0);
	});

	it("records workspace open cancellation and handled failure distinctly", async () => {
		const { sink, telemetry } = setup();
		const selection = workspaceWithAgents();

		await telemetry.traceOpen("command", undefined, (trace) => {
			trace.cancel("agent_picker", { workspace: selection.workspace });
			return Promise.resolve(false);
		});
		await telemetry.traceOpen("command", undefined, (trace) => {
			trace.fail("fetch_failed");
			return Promise.resolve(false);
		});

		const [cancelled, failed] = sink.eventsNamed("workspace.open");
		expect(cancelled.properties).toMatchObject({
			cancel_stage: "agent_picker",
			workspace_status: "running",
			result: "aborted",
		});
		expect(failed.properties).toMatchObject({
			failure_category: "fetch_failed",
			result: "error",
		});
	});

	it("records thrown workspace open failures without raw error details", async () => {
		const { sink, telemetry } = setup();

		await expect(
			telemetry.traceOpen("command", undefined, () =>
				Promise.reject(new Error("secret path /tmp/workspace")),
			),
		).rejects.toThrow("secret path /tmp/workspace");

		const event = sink.expectOne("workspace.open");
		expect(event.properties).toMatchObject({
			failure_category: "error",
			result: "error",
		});
		expect(event.error).toBeUndefined();
	});

	it("records thrown devcontainer failures without raw error details", async () => {
		const { sink, telemetry } = setup();

		await expect(
			telemetry.traceDevcontainer("dev_container", () =>
				Promise.reject(new Error("secret local path /tmp/workspace")),
			),
		).rejects.toThrow("secret local path /tmp/workspace");

		const event = sink.expectOne("workspace.dev_container.open");
		expect(event.properties).toMatchObject({
			failure_category: "error",
			mode: "dev_container",
			result: "error",
		});
		expect(event.error).toBeUndefined();
	});
});
