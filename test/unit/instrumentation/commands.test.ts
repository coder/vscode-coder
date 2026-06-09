import { describe, expect, it } from "vitest";

import { CommandTelemetry } from "@/instrumentation/commands";

import { agent, resource, workspace } from "@repo/mocks";

import { createTelemetryHarness } from "../../mocks/telemetry";

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

describe("command instrumentation helpers", () => {
	it("records workspace selection without workspace or agent names", async () => {
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandTelemetry(service);
		const selection = workspaceWithAgents();

		await traces.workspaceOpen(
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
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandTelemetry(service);

		await traces.workspacePicker("workspace_open", (telemetry) => {
			telemetry.cancelled(3);
			return Promise.resolve({ status: "cancelled" });
		});
		await traces.workspacePicker("workspace_open", (telemetry) => {
			telemetry.failed("fetch_failed", 0);
			return Promise.resolve({ status: "failed", category: "fetch_failed" });
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
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandTelemetry(service);
		const selection = workspaceWithAgents();

		await traces.workspaceOpen("command", undefined, (telemetry) =>
			Promise.resolve(
				telemetry.cancel("agent_picker", { workspace: selection.workspace }),
			),
		);
		await traces.workspaceOpen("command", undefined, (telemetry) =>
			Promise.resolve(telemetry.fail("fetch_failed")),
		);

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
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandTelemetry(service);

		await expect(
			traces.workspaceOpen("command", undefined, () =>
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

	it("records diagnostic cancellation and failure categories", async () => {
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandTelemetry(service);
		const failure = new Error("boom");

		await traces.diagnostic("support_bundle", (telemetry) => {
			telemetry.cancel("save_dialog");
			return Promise.resolve();
		});
		await traces.diagnostic("support_bundle", (telemetry) => {
			telemetry.fail(failure, "unsupported_cli");
			return Promise.resolve();
		});

		const [cancelled, failed] = sink.eventsNamed(
			"command.diagnostic.completed",
		);
		expect(cancelled.properties).toMatchObject({
			cancel_stage: "save_dialog",
			result: "aborted",
		});
		expect(failed.properties).toMatchObject({
			failure_category: "unsupported_cli",
			result: "error",
		});
		expect(failed.error).toBeUndefined();
	});

	it("records bounded speed test measurements", async () => {
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandTelemetry(service);

		await traces.diagnostic("speed_test", (telemetry) => {
			const parsed = telemetry.speedtestSuccess(
				JSON.stringify({
					overall: {
						start_time_seconds: 0,
						end_time_seconds: 5,
						throughput_mbits: 42,
					},
					intervals: [
						{
							start_time_seconds: 0,
							end_time_seconds: 5,
							throughput_mbits: 42,
						},
					],
				}),
			);
			expect(parsed.overall.throughput_mbits).toBe(42);
			return Promise.resolve();
		});

		expect(sink.expectOne("command.diagnostic.completed")).toMatchObject({
			measurements: {
				interval_count: 1,
				throughput_mbits: 42,
			},
			properties: { result: "success" },
		});
	});

	it("records thrown devcontainer failures without raw error details", async () => {
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandTelemetry(service);

		await expect(
			traces.devcontainerOpen("dev_container", () =>
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
