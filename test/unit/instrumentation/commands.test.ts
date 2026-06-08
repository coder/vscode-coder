import { describe, expect, it } from "vitest";

import { CommandInstrumentation } from "@/instrumentation/commands";

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
		const traces = new CommandInstrumentation(service);
		const selection = workspaceWithAgents();

		await traces.workspaceOpen(
			"command",
			{ workspace: selection.workspace, agent: selection.connected },
			() => Promise.resolve(true),
		);

		const event = sink.expectOne("workspace.open");
		expect(event.properties).toMatchObject({
			"agent.lifecycle_state": "ready",
			"agent.status": "connected",
			"workspace.outdated": "true",
			"workspace.status": "running",
			result: "success",
		});
		expect(event.measurements).toMatchObject({
			agentCount: 2,
			connectedAgentCount: 1,
		});
		expect(event.properties.workspaceName).toBeUndefined();
		expect(event.properties.agentName).toBeUndefined();
	});

	it("records workspace picker cancellation and failure distinctly", async () => {
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandInstrumentation(service);

		await traces.workspacePicker("workspace.open", (telemetry) => {
			telemetry.cancelled(3);
			return Promise.resolve({ status: "cancelled" });
		});
		await traces.workspacePicker("workspace.open", (telemetry) => {
			telemetry.failed("fetch_failed", 0);
			return Promise.resolve({ status: "failed", category: "fetch_failed" });
		});

		const [cancelled, failed] = sink.eventsNamed("workspace.picker.prompted");
		expect(cancelled.properties).toMatchObject({ result: "aborted" });
		expect(cancelled.measurements.workspaceCount).toBe(3);
		expect(failed.properties).toMatchObject({
			"failure.category": "fetch_failed",
			result: "error",
		});
		expect(failed.measurements.workspaceCount).toBe(0);
	});

	it("records workspace open cancellation and handled failure distinctly", async () => {
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandInstrumentation(service);
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
			"cancel.stage": "agent_picker",
			"workspace.status": "running",
			result: "aborted",
		});
		expect(failed.properties).toMatchObject({
			"failure.category": "fetch_failed",
			result: "error",
		});
	});

	it("records thrown workspace open failures without raw error details", async () => {
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandInstrumentation(service);

		await expect(
			traces.workspaceOpen("command", undefined, () =>
				Promise.reject(new Error("secret path /tmp/workspace")),
			),
		).rejects.toThrow("secret path /tmp/workspace");

		const event = sink.expectOne("workspace.open");
		expect(event.properties).toMatchObject({
			"failure.category": "error",
			result: "error",
		});
		expect(event.error).toBeUndefined();
	});

	it("records diagnostic cancellation and failure categories", async () => {
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandInstrumentation(service);
		const failure = new Error("boom");

		await traces.diagnostic("coder.supportBundle", (telemetry) => {
			telemetry.cancel("save_dialog");
			return Promise.resolve();
		});
		await traces.diagnostic("coder.supportBundle", (telemetry) => {
			telemetry.fail(failure, "unsupported_cli");
			return Promise.resolve();
		});

		const [cancelled, failed] = sink.eventsNamed(
			"command.diagnostic.completed",
		);
		expect(cancelled.properties).toMatchObject({
			"cancel.stage": "save_dialog",
			result: "aborted",
		});
		expect(failed.properties).toMatchObject({
			"failure.category": "unsupported_cli",
			result: "error",
		});
		expect(failed.error).toBeUndefined();
	});

	it("records bounded speed test measurements", async () => {
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandInstrumentation(service);

		await traces.diagnostic("coder.speedTest", (telemetry) => {
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
				intervalCount: 1,
				throughputMbits: 42,
			},
			properties: { result: "success" },
		});
	});

	it("records thrown devcontainer failures without raw error details", async () => {
		const { sink, service } = createTelemetryHarness();
		const traces = new CommandInstrumentation(service);

		await expect(
			traces.devcontainerOpen("dev_container", () =>
				Promise.reject(new Error("secret local path /tmp/workspace")),
			),
		).rejects.toThrow("secret local path /tmp/workspace");

		const event = sink.expectOne("workspace.devcontainer.open");
		expect(event.properties).toMatchObject({
			"failure.category": "error",
			mode: "dev_container",
			result: "error",
		});
		expect(event.error).toBeUndefined();
	});
});
