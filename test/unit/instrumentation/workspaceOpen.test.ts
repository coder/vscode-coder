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
			"agent.count": 2,
			"agent.connected_count": 1,
		});
		expect(event.properties.workspace_name).toBeUndefined();
		expect(event.properties.agent_name).toBeUndefined();
	});

	it("counts every connected agent on the workspace", async () => {
		const { sink, telemetry } = setup();
		const first = agent({ status: "connected", lifecycle_state: "ready" });
		const second = agent({
			id: "agent-2",
			name: "secondary",
			status: "connected",
			lifecycle_state: "ready",
		});
		const offline = agent({
			id: "agent-3",
			name: "tertiary",
			status: "disconnected",
			lifecycle_state: "off",
		});
		const selection = workspace({
			latest_build: {
				status: "running",
				resources: [resource({ agents: [first, second, offline] })],
			},
		});

		await telemetry.traceOpen("command", { workspace: selection }, () =>
			Promise.resolve(true),
		);

		const event = sink.expectOne("workspace.open");
		expect(event.measurements).toMatchObject({
			"agent.count": 3,
			"agent.connected_count": 2,
		});
	});

	it("records workspace picker cancellation and failure distinctly", async () => {
		const { sink, telemetry } = setup();

		await telemetry.tracePicker("workspace_open", (trace) => {
			const result = { status: "cancelled" } as const;
			trace.finish(result, 3);
			return Promise.resolve(result);
		});
		await telemetry.tracePicker("workspace_open", (trace) => {
			const result = { status: "failed", category: "fetch_error" } as const;
			trace.finish(result, 0);
			return Promise.resolve(result);
		});

		const [cancelled, failed] = sink.eventsNamed("workspace.picker.prompted");
		expect(cancelled.properties).toMatchObject({ result: "aborted" });
		expect(cancelled.measurements["workspace.count"]).toBe(3);
		expect(failed.properties).toMatchObject({
			"error.type": "fetch_error",
			result: "error",
		});
		expect(failed.measurements["workspace.count"]).toBe(0);
	});

	it("records workspace open cancellation and handled failure distinctly", async () => {
		const { sink, telemetry } = setup();
		const selection = workspaceWithAgents();

		await telemetry.traceOpen("command", undefined, (trace) => {
			trace.abort("agent_picker", { workspace: selection.workspace });
			return Promise.resolve(false);
		});
		await telemetry.traceOpen("command", undefined, (trace) => {
			trace.error("fetch_error");
			return Promise.resolve(false);
		});

		const [cancelled, failed] = sink.eventsNamed("workspace.open");
		expect(cancelled.properties).toMatchObject({
			abort_stage: "agent_picker",
			workspace_status: "running",
			result: "aborted",
		});
		expect(failed.properties).toMatchObject({
			"error.type": "fetch_error",
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
			"error.type": "error",
			result: "error",
		});
		expect(event.error).toBeUndefined();
	});

	it("records a thrown abort as aborted without an error.type", async () => {
		const { sink, telemetry } = setup();
		const abort = Object.assign(new Error("user backed out"), {
			name: "AbortError",
		});

		await expect(
			telemetry.traceOpen("command", undefined, () => Promise.reject(abort)),
		).rejects.toThrow("user backed out");

		const event = sink.expectOne("workspace.open");
		expect(event.properties).toMatchObject({ result: "aborted" });
		expect(event.properties["error.type"]).toBeUndefined();
	});

	it("records thrown devcontainer failures without raw error details", async () => {
		const { sink, telemetry } = setup();

		await expect(
			telemetry.traceDevContainer("dev_container", () =>
				Promise.reject(new Error("secret local path /tmp/workspace")),
			),
		).rejects.toThrow("secret local path /tmp/workspace");

		const event = sink.expectOne("workspace.dev_container.open");
		expect(event.properties).toMatchObject({
			"error.type": "error",
			mode: "dev_container",
			result: "error",
		});
		expect(event.error).toBeUndefined();
	});
});
