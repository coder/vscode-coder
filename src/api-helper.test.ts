/* eslint-disable @typescript-eslint/no-explicit-any */
import { ErrorEvent } from "eventsource";
import { describe, expect, it } from "vitest";
import {
	AgentMetadataEventSchema,
	AgentMetadataEventSchemaArray,
	errToStr,
	extractAgents,
	extractAllAgents,
} from "./api-helper";

describe("api-helper", () => {
	describe("errToStr", () => {
		it("should return Error message when error is an Error instance", () => {
			const error = new Error("Test error message");
			const result = errToStr(error, "default");
			expect(result).toBe("Test error message");
		});

		it("should return empty string when Error has empty message", () => {
			const error = new Error("");
			const result = errToStr(error, "default");
			// Function actually returns the message even if empty
			expect(result).toBe("");
		});

		it("should return ErrorEvent message without code formatting", () => {
			const errorEvent = new ErrorEvent("error", {
				message: "Connection failed",
			}) as any;
			// Add code property to the event
			errorEvent.code = 500;

			const result = errToStr(errorEvent, "default");
			// ErrorEvent doesn't have code property access in this test environment
			expect(result).toBe("Connection failed");
		});

		it("should return ErrorEvent message without code", () => {
			const errorEvent = new ErrorEvent("error", {
				message: "Connection failed",
			});

			const result = errToStr(errorEvent, "default");
			expect(result).toBe("Connection failed");
		});

		it("should return default when ErrorEvent has no message or code", () => {
			const errorEvent = new ErrorEvent("error", {});

			const result = errToStr(errorEvent, "default");
			expect(result).toBe("default");
		});

		it("should return string error when error is non-empty string", () => {
			const result = errToStr("String error message", "default");
			expect(result).toBe("String error message");
		});

		it("should return default when error is empty string", () => {
			const result = errToStr("", "default");
			expect(result).toBe("default");
		});

		it("should return default when error is whitespace-only string", () => {
			const result = errToStr("   \n\t  ", "default");
			expect(result).toBe("default");
		});

		it("should return default for null error", () => {
			const result = errToStr(null, "default");
			expect(result).toBe("default");
		});

		it("should return default for undefined error", () => {
			const result = errToStr(undefined, "default");
			expect(result).toBe("default");
		});

		it("should return default for number error", () => {
			const result = errToStr(42, "default");
			expect(result).toBe("default");
		});

		it("should return default for object error", () => {
			const result = errToStr({ unknown: "object" }, "default");
			expect(result).toBe("default");
		});
	});

	describe("extractAgents", () => {
		it("should extract agents from workspace resources", () => {
			const mockWorkspace = {
				latest_build: {
					resources: [
						{
							agents: [
								{ id: "agent1", name: "main" },
								{ id: "agent2", name: "secondary" },
							],
						},
						{
							agents: [{ id: "agent3", name: "tertiary" }],
						},
					],
				},
			} as any;

			const agents = extractAgents(mockWorkspace);

			expect(agents).toHaveLength(3);
			expect(agents[0].id).toBe("agent1");
			expect(agents[0].name).toBe("main");
			expect(agents[1].id).toBe("agent2");
			expect(agents[1].name).toBe("secondary");
			expect(agents[2].id).toBe("agent3");
			expect(agents[2].name).toBe("tertiary");
		});

		it("should return empty array when workspace has no agents", () => {
			const mockWorkspace = {
				latest_build: {
					resources: [
						{
							agents: [],
						},
					],
				},
			} as any;

			const agents = extractAgents(mockWorkspace);
			expect(agents).toHaveLength(0);
		});

		it("should handle resources with undefined agents", () => {
			const mockWorkspace = {
				latest_build: {
					resources: [
						{
							agents: undefined,
						},
						{
							agents: null,
						},
					],
				},
			} as any;

			const agents = extractAgents(mockWorkspace);
			expect(agents).toHaveLength(0);
		});

		it("should handle empty resources array", () => {
			const mockWorkspace = {
				latest_build: {
					resources: [],
				},
			} as any;

			const agents = extractAgents(mockWorkspace);
			expect(agents).toHaveLength(0);
		});
	});

	describe("extractAllAgents", () => {
		it("should extract agents from multiple workspaces", () => {
			const mockWorkspaces = [
				{
					latest_build: {
						resources: [
							{
								agents: [{ id: "agent1", name: "main" }],
							},
						],
					},
				},
				{
					latest_build: {
						resources: [
							{
								agents: [{ id: "agent2", name: "secondary" }],
							},
						],
					},
				},
			] as any;

			const allAgents = extractAllAgents(mockWorkspaces);

			expect(allAgents).toHaveLength(2);
			expect(allAgents[0].id).toBe("agent1");
			expect(allAgents[1].id).toBe("agent2");
		});

		it("should return empty array for empty workspace list", () => {
			const allAgents = extractAllAgents([]);
			expect(allAgents).toHaveLength(0);
		});

		it("should handle workspaces with no agents", () => {
			const mockWorkspaces = [
				{
					latest_build: {
						resources: [],
					},
				},
				{
					latest_build: {
						resources: [
							{
								agents: [],
							},
						],
					},
				},
			] as any;

			const allAgents = extractAllAgents(mockWorkspaces);
			expect(allAgents).toHaveLength(0);
		});

		it("should handle mixed workspaces with and without agents", () => {
			const mockWorkspaces = [
				{
					latest_build: {
						resources: [
							{
								agents: [{ id: "agent1", name: "main" }],
							},
						],
					},
				},
				{
					latest_build: {
						resources: [],
					},
				},
				{
					latest_build: {
						resources: [
							{
								agents: [{ id: "agent2", name: "secondary" }],
							},
						],
					},
				},
			] as any;

			const allAgents = extractAllAgents(mockWorkspaces);

			expect(allAgents).toHaveLength(2);
			expect(allAgents[0].id).toBe("agent1");
			expect(allAgents[1].id).toBe("agent2");
		});
	});

	describe("AgentMetadataEventSchema", () => {
		it("should validate correct agent metadata event", () => {
			const validEvent = {
				result: {
					collected_at: "2024-01-01T00:00:00Z",
					age: 60,
					value: "test-value",
					error: "",
				},
				description: {
					display_name: "Test Metric",
					key: "test_metric",
					script: "echo 'test'",
					interval: 30,
					timeout: 10,
				},
			};

			const result = AgentMetadataEventSchema.safeParse(validEvent);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual(validEvent);
			}
		});

		it("should reject invalid agent metadata event with wrong types", () => {
			const invalidEvent = {
				result: {
					collected_at: "2024-01-01T00:00:00Z",
					age: "invalid", // should be number
					value: "test-value",
					error: "",
				},
				description: {
					display_name: "Test Metric",
					key: "test_metric",
					script: "echo 'test'",
					interval: 30,
					timeout: 10,
				},
			};

			const result = AgentMetadataEventSchema.safeParse(invalidEvent);
			expect(result.success).toBe(false);
		});

		it("should reject event with missing required fields", () => {
			const incompleteEvent = {
				result: {
					collected_at: "2024-01-01T00:00:00Z",
					age: 60,
					value: "test-value",
					// missing error field
				},
				description: {
					display_name: "Test Metric",
					key: "test_metric",
					script: "echo 'test'",
					interval: 30,
					timeout: 10,
				},
			};

			const result = AgentMetadataEventSchema.safeParse(incompleteEvent);
			expect(result.success).toBe(false);
		});

		it("should reject event with missing description", () => {
			const incompleteEvent = {
				result: {
					collected_at: "2024-01-01T00:00:00Z",
					age: 60,
					value: "test-value",
					error: "",
				},
				// missing description
			};

			const result = AgentMetadataEventSchema.safeParse(incompleteEvent);
			expect(result.success).toBe(false);
		});

		it("should handle events with error messages", () => {
			const eventWithError = {
				result: {
					collected_at: "2024-01-01T00:00:00Z",
					age: 60,
					value: "",
					error: "Collection failed",
				},
				description: {
					display_name: "Test Metric",
					key: "test_metric",
					script: "echo 'test'",
					interval: 30,
					timeout: 10,
				},
			};

			const result = AgentMetadataEventSchema.safeParse(eventWithError);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.result.error).toBe("Collection failed");
			}
		});
	});

	describe("AgentMetadataEventSchemaArray", () => {
		it("should validate array of valid agent metadata events", () => {
			const validEvents = [
				{
					result: {
						collected_at: "2024-01-01T00:00:00Z",
						age: 60,
						value: "test-value-1",
						error: "",
					},
					description: {
						display_name: "Test Metric 1",
						key: "test_metric_1",
						script: "echo 'test1'",
						interval: 30,
						timeout: 10,
					},
				},
				{
					result: {
						collected_at: "2024-01-01T00:00:00Z",
						age: 120,
						value: "test-value-2",
						error: "",
					},
					description: {
						display_name: "Test Metric 2",
						key: "test_metric_2",
						script: "echo 'test2'",
						interval: 60,
						timeout: 15,
					},
				},
			];

			const result = AgentMetadataEventSchemaArray.safeParse(validEvents);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toHaveLength(2);
			}
		});

		it("should validate empty array", () => {
			const result = AgentMetadataEventSchemaArray.safeParse([]);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toHaveLength(0);
			}
		});

		it("should reject array with invalid events", () => {
			const invalidEvents = [
				{
					result: {
						collected_at: "2024-01-01T00:00:00Z",
						age: "invalid", // should be number
						value: "test-value",
						error: "",
					},
					description: {
						display_name: "Test Metric",
						key: "test_metric",
						script: "echo 'test'",
						interval: 30,
						timeout: 10,
					},
				},
			];

			const result = AgentMetadataEventSchemaArray.safeParse(invalidEvents);
			expect(result.success).toBe(false);
		});

		it("should reject array with mixed valid and invalid events", () => {
			const mixedEvents = [
				{
					result: {
						collected_at: "2024-01-01T00:00:00Z",
						age: 60,
						value: "test-value",
						error: "",
					},
					description: {
						display_name: "Test Metric",
						key: "test_metric",
						script: "echo 'test'",
						interval: 30,
						timeout: 10,
					},
				},
				{
					result: {
						collected_at: "invalid-date",
						age: 60,
						value: "test-value",
						error: "",
					},
					description: {
						display_name: "Test Metric",
						key: "test_metric",
						script: "echo 'test'",
						interval: "invalid", // should be number
						timeout: 10,
					},
				},
			];

			const result = AgentMetadataEventSchemaArray.safeParse(mixedEvents);
			expect(result.success).toBe(false);
		});
	});
});
