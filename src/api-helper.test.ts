import { ErrorEvent } from "eventsource";
import { describe, expect, it } from "vitest";
import {
	AgentMetadataEventSchema,
	AgentMetadataEventSchemaArray,
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

		it("should handle API error response", () => {
			const apiError = {
				isAxiosError: true,
				response: {
					data: {
						message: "API request failed",
						detail: "API request failed",
					},
				},
			};
			expect(errToStr(apiError, "default")).toBe("API request failed");
		});

		it("should handle API error response object", () => {
			const apiErrorResponse = {
				detail: "Invalid authentication",
				message: "Invalid authentication",
			};
			expect(errToStr(apiErrorResponse, "default")).toBe(
				"Invalid authentication",
			);
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
			const validEvent = createValidMetadataEvent();
			const result = AgentMetadataEventSchema.safeParse(validEvent);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.result.collected_at).toBe("2024-01-01T00:00:00Z");
				expect(result.data.result.age).toBe(60);
				expect(result.data.result.value).toBe("test-value");
				expect(result.data.result.error).toBe("");
				expect(result.data.description.display_name).toBe("Test Metric");
				expect(result.data.description.key).toBe("test_metric");
				expect(result.data.description.script).toBe("echo 'test'");
				expect(result.data.description.interval).toBe(30);
				expect(result.data.description.timeout).toBe(10);
			}
		});

		it("should reject invalid event", () => {
			const event = createValidMetadataEvent({ age: "invalid" });
			const result = AgentMetadataEventSchema.safeParse(event);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].code).toBe("invalid_type");
				expect(result.error.issues[0].path).toEqual(["result", "age"]);
			}
		});

		it("should validate array of events", () => {
			const events = [
				createValidMetadataEvent(),
				createValidMetadataEvent({ value: "different-value" }),
			];
			const result = AgentMetadataEventSchemaArray.safeParse(events);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toHaveLength(2);
				expect(result.data[0].result.value).toBe("test-value");
				expect(result.data[1].result.value).toBe("different-value");
			}
		});

		it("should reject array with invalid events", () => {
			const events = [createValidMetadataEvent(), { invalid: "structure" }];
			const result = AgentMetadataEventSchemaArray.safeParse(events);
			expect(result.success).toBe(false);
		});

		it("should handle missing required fields", () => {
			const incompleteEvent = {
				result: {
					collected_at: "2024-01-01T00:00:00Z",
					// missing age, value, error
				},
				description: {
					display_name: "Test",
					// missing other fields
				},
			};
			const result = AgentMetadataEventSchema.safeParse(incompleteEvent);
			expect(result.success).toBe(false);
			if (!result.success) {
				const missingFields = result.error.issues.map(
					(issue) => issue.path[issue.path.length - 1],
				);
				expect(missingFields).toContain("age");
				expect(missingFields).toContain("value");
				expect(missingFields).toContain("error");
			}
		});
	});
});
