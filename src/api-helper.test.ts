import { ErrorEvent } from "eventsource";
import { describe, expect, it } from "vitest";
import {
	AgentMetadataEventSchema,
	errToStr,
	extractAgents,
	extractAllAgents,
} from "./api-helper";
import {
	createMockAgent,
	createMockWorkspace,
	createWorkspaceWithAgents,
} from "./test-helpers";

// Test helpers
const createMockResource = (
	id: string,
	agents?: ReturnType<typeof createMockAgent>[],
) => ({
	id,
	created_at: new Date().toISOString(),
	job_id: "job-id",
	workspace_transition: "start" as const,
	type: "docker_container",
	name: id,
	hide: false,
	icon: "",
	agents,
	metadata: [],
	daily_cost: 0,
});

const createValidMetadataEvent = (overrides: Record<string, unknown> = {}) => ({
	result: {
		collected_at: "2024-01-01T00:00:00Z",
		age: 60,
		value: "test-value",
		error: "",
		...overrides,
	},
	description: {
		display_name: "Test Metric",
		key: "test_metric",
		script: "echo 'test'",
		interval: 30,
		timeout: 10,
	},
});

describe("api-helper", () => {
	describe("errToStr", () => {
		it.each([
			["Error instance", new Error("Test error message"), "Test error message"],
			["Error with empty message", new Error(""), ""],
			["non-empty string", "String error message", "String error message"],
			["empty string", "", "default"],
			["whitespace-only string", "   \n\t  ", "default"],
			["null", null, "default"],
			["undefined", undefined, "default"],
			["number", 42, "default"],
			["object", { unknown: "object" }, "default"],
		])("should handle %s", (_, input, expected) => {
			expect(errToStr(input, "default")).toBe(expected);
		});

		it.each([
			["with message", { message: "Connection failed" }, "Connection failed"],
			["without message", {}, "default"],
		])("should handle ErrorEvent %s", (_, eventInit, expected) => {
			const errorEvent = new ErrorEvent("error", eventInit);
			expect(errToStr(errorEvent, "default")).toBe(expected);
		});
	});

	describe("extractAgents", () => {
		it.each([
			[
				"multiple resources with agents",
				[
					createMockResource("resource-1", [
						createMockAgent({ id: "agent1", name: "main" }),
						createMockAgent({ id: "agent2", name: "secondary" }),
					]),
					createMockResource("resource-2", [
						createMockAgent({ id: "agent3", name: "tertiary" }),
					]),
				],
				3,
				["agent1", "agent2", "agent3"],
			],
			["empty resources", [], 0, []],
			[
				"resources with undefined agents",
				[createMockResource("resource-1", undefined)],
				0,
				[],
			],
			[
				"resources with empty agents",
				[createMockResource("resource-1", [])],
				0,
				[],
			],
		])("should handle %s", (_, resources, expectedCount, expectedIds) => {
			const mockWorkspace = createMockWorkspace({
				latest_build: {
					...createMockWorkspace().latest_build,
					resources,
				},
			});

			const agents = extractAgents(mockWorkspace);
			expect(agents).toHaveLength(expectedCount);
			expect(agents.map((a) => a.id)).toEqual(expectedIds);
		});
	});

	describe("extractAllAgents", () => {
		it.each([
			[
				"multiple workspaces with agents",
				[
					createWorkspaceWithAgents([{ id: "agent1", name: "main" }]),
					createWorkspaceWithAgents([{ id: "agent2", name: "secondary" }]),
				],
				["agent1", "agent2"],
			],
			["empty workspace list", [], []],
			[
				"mixed workspaces",
				[
					createWorkspaceWithAgents([{ id: "agent1", name: "main" }]),
					createMockWorkspace({
						latest_build: {
							...createMockWorkspace().latest_build,
							resources: [],
						},
					}),
					createWorkspaceWithAgents([{ id: "agent2", name: "secondary" }]),
				],
				["agent1", "agent2"],
			],
		])("should handle %s", (_, workspaces, expectedIds) => {
			const allAgents = extractAllAgents(workspaces);
			expect(allAgents.map((a) => a.id)).toEqual(expectedIds);
		});
	});

	describe("AgentMetadataEventSchema", () => {
		it("should validate correct event", () => {
			const result = AgentMetadataEventSchema.safeParse(
				createValidMetadataEvent(),
			);
			expect(result.success).toBe(true);
		});

		it("should reject invalid event", () => {
			const event = createValidMetadataEvent({ age: "invalid" });
			const result = AgentMetadataEventSchema.safeParse(event);
			expect(result.success).toBe(false);
		});
	});
});
