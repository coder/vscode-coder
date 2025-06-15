import { isApiError, isApiErrorResponse } from "coder/site/src/api/errors";
import {
	Workspace,
	WorkspaceAgent,
	WorkspaceResource,
} from "coder/site/src/api/typesGenerated";
import { ErrorEvent } from "eventsource";
import { describe, it, expect, vi } from "vitest";
import {
	errToStr,
	extractAllAgents,
	extractAgents,
	AgentMetadataEventSchema,
	AgentMetadataEventSchemaArray,
} from "./api-helper";

// Mock the coder API error functions
vi.mock("coder/site/src/api/errors", () => ({
	isApiError: vi.fn(),
	isApiErrorResponse: vi.fn(),
}));

describe("errToStr", () => {
	const defaultMessage = "Default error message";

	it("should return Error message when error is Error instance", () => {
		const error = new Error("Test error message");
		expect(errToStr(error, defaultMessage)).toBe("Test error message");
	});

	it("should return default when Error has no message", () => {
		const error = new Error("");
		expect(errToStr(error, defaultMessage)).toBe(defaultMessage);
	});

	it("should return API error message when isApiError returns true", () => {
		const apiError = {
			response: {
				data: {
					message: "API error occurred",
				},
			},
		};
		vi.mocked(isApiError).mockReturnValue(true);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr(apiError, defaultMessage)).toBe("API error occurred");
	});

	it("should return API error response message when isApiErrorResponse returns true", () => {
		const apiErrorResponse = {
			message: "API response error",
		};
		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(true);

		expect(errToStr(apiErrorResponse, defaultMessage)).toBe(
			"API response error",
		);
	});

	it("should handle ErrorEvent with code and message", () => {
		const errorEvent = new ErrorEvent("error");
		// Mock the properties since ErrorEvent constructor might not set them
		Object.defineProperty(errorEvent, "code", {
			value: "E001",
			writable: true,
		});
		Object.defineProperty(errorEvent, "message", {
			value: "Connection failed",
			writable: true,
		});

		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr(errorEvent, defaultMessage)).toBe(
			"E001: Connection failed",
		);
	});

	it("should handle ErrorEvent with code but no message", () => {
		const errorEvent = new ErrorEvent("error");
		Object.defineProperty(errorEvent, "code", {
			value: "E002",
			writable: true,
		});
		Object.defineProperty(errorEvent, "message", { value: "", writable: true });

		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr(errorEvent, defaultMessage)).toBe(
			"E002: Default error message",
		);
	});

	it("should handle ErrorEvent with message but no code", () => {
		const errorEvent = new ErrorEvent("error");
		Object.defineProperty(errorEvent, "code", { value: "", writable: true });
		Object.defineProperty(errorEvent, "message", {
			value: "Network timeout",
			writable: true,
		});

		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr(errorEvent, defaultMessage)).toBe("Network timeout");
	});

	it("should handle ErrorEvent with no code or message", () => {
		const errorEvent = new ErrorEvent("error");
		Object.defineProperty(errorEvent, "code", { value: "", writable: true });
		Object.defineProperty(errorEvent, "message", { value: "", writable: true });

		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr(errorEvent, defaultMessage)).toBe(defaultMessage);
	});

	it("should return string error when error is non-empty string", () => {
		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr("String error message", defaultMessage)).toBe(
			"String error message",
		);
	});

	it("should return default when error is empty string", () => {
		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr("", defaultMessage)).toBe(defaultMessage);
	});

	it("should return default when error is whitespace-only string", () => {
		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr("   \t\n  ", defaultMessage)).toBe(defaultMessage);
	});

	it("should return default when error is null", () => {
		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr(null, defaultMessage)).toBe(defaultMessage);
	});

	it("should return default when error is undefined", () => {
		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr(undefined, defaultMessage)).toBe(defaultMessage);
	});

	it("should return default when error is number", () => {
		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr(42, defaultMessage)).toBe(defaultMessage);
	});

	it("should return default when error is object without recognized structure", () => {
		vi.mocked(isApiError).mockReturnValue(false);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		expect(errToStr({ random: "object" }, defaultMessage)).toBe(defaultMessage);
	});

	it("should prioritize Error instance over API error", () => {
		const error = new Error("Error message");
		// Mock the error to also be recognized as an API error
		vi.mocked(isApiError).mockReturnValue(true);
		vi.mocked(isApiErrorResponse).mockReturnValue(false);

		// Add API error structure to the Error object
		(error as Error & { response: { data: { message: string } } }).response = {
			data: {
				message: "API error message",
			},
		};

		// Error instance check comes first in the function, so Error message is returned
		expect(errToStr(error, defaultMessage)).toBe("Error message");
	});
});

describe("extractAgents", () => {
	it("should extract agents from workspace resources", () => {
		const agent1: WorkspaceAgent = {
			id: "agent-1",
			name: "main",
		} as WorkspaceAgent;

		const agent2: WorkspaceAgent = {
			id: "agent-2",
			name: "secondary",
		} as WorkspaceAgent;

		const workspace: Workspace = {
			latest_build: {
				resources: [
					{
						agents: [agent1],
					} as WorkspaceResource,
					{
						agents: [agent2],
					} as WorkspaceResource,
				],
			},
		} as Workspace;

		const result = extractAgents(workspace);
		expect(result).toHaveLength(2);
		expect(result).toContain(agent1);
		expect(result).toContain(agent2);
	});

	it("should handle resources with no agents", () => {
		const workspace: Workspace = {
			latest_build: {
				resources: [
					{
						agents: undefined,
					} as WorkspaceResource,
					{
						agents: [],
					} as WorkspaceResource,
				],
			},
		} as Workspace;

		const result = extractAgents(workspace);
		expect(result).toHaveLength(0);
	});

	it("should handle workspace with no resources", () => {
		const workspace: Workspace = {
			latest_build: {
				resources: [],
			},
		} as Workspace;

		const result = extractAgents(workspace);
		expect(result).toHaveLength(0);
	});

	it("should handle mixed resources with and without agents", () => {
		const agent1: WorkspaceAgent = {
			id: "agent-1",
			name: "main",
		} as WorkspaceAgent;

		const workspace: Workspace = {
			latest_build: {
				resources: [
					{
						agents: [agent1],
					} as WorkspaceResource,
					{
						agents: undefined,
					} as WorkspaceResource,
					{
						agents: [],
					} as WorkspaceResource,
				],
			},
		} as Workspace;

		const result = extractAgents(workspace);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(agent1);
	});

	it("should handle multiple agents in single resource", () => {
		const agent1: WorkspaceAgent = {
			id: "agent-1",
			name: "main",
		} as WorkspaceAgent;

		const agent2: WorkspaceAgent = {
			id: "agent-2",
			name: "secondary",
		} as WorkspaceAgent;

		const workspace: Workspace = {
			latest_build: {
				resources: [
					{
						agents: [agent1, agent2],
					} as WorkspaceResource,
				],
			},
		} as Workspace;

		const result = extractAgents(workspace);
		expect(result).toHaveLength(2);
		expect(result).toContain(agent1);
		expect(result).toContain(agent2);
	});
});

describe("extractAllAgents", () => {
	it("should extract agents from multiple workspaces", () => {
		const agent1: WorkspaceAgent = {
			id: "agent-1",
			name: "main",
		} as WorkspaceAgent;

		const agent2: WorkspaceAgent = {
			id: "agent-2",
			name: "secondary",
		} as WorkspaceAgent;

		const workspace1: Workspace = {
			latest_build: {
				resources: [
					{
						agents: [agent1],
					} as WorkspaceResource,
				],
			},
		} as Workspace;

		const workspace2: Workspace = {
			latest_build: {
				resources: [
					{
						agents: [agent2],
					} as WorkspaceResource,
				],
			},
		} as Workspace;

		const result = extractAllAgents([workspace1, workspace2]);
		expect(result).toHaveLength(2);
		expect(result).toContain(agent1);
		expect(result).toContain(agent2);
	});

	it("should handle empty workspace array", () => {
		const result = extractAllAgents([]);
		expect(result).toHaveLength(0);
	});

	it("should handle workspaces with no agents", () => {
		const workspace1: Workspace = {
			latest_build: {
				resources: [],
			},
		} as Workspace;

		const workspace2: Workspace = {
			latest_build: {
				resources: [
					{
						agents: undefined,
					} as WorkspaceResource,
				],
			},
		} as Workspace;

		const result = extractAllAgents([workspace1, workspace2]);
		expect(result).toHaveLength(0);
	});

	it("should maintain order of agents across workspaces", () => {
		const agent1: WorkspaceAgent = {
			id: "agent-1",
			name: "first",
		} as WorkspaceAgent;

		const agent2: WorkspaceAgent = {
			id: "agent-2",
			name: "second",
		} as WorkspaceAgent;

		const agent3: WorkspaceAgent = {
			id: "agent-3",
			name: "third",
		} as WorkspaceAgent;

		const workspace1: Workspace = {
			latest_build: {
				resources: [
					{
						agents: [agent1, agent2],
					} as WorkspaceResource,
				],
			},
		} as Workspace;

		const workspace2: Workspace = {
			latest_build: {
				resources: [
					{
						agents: [agent3],
					} as WorkspaceResource,
				],
			},
		} as Workspace;

		const result = extractAllAgents([workspace1, workspace2]);
		expect(result).toHaveLength(3);
		expect(result[0]).toBe(agent1);
		expect(result[1]).toBe(agent2);
		expect(result[2]).toBe(agent3);
	});
});

describe("AgentMetadataEventSchema", () => {
	it("should validate valid agent metadata event", () => {
		const validEvent = {
			result: {
				collected_at: "2023-01-01T00:00:00Z",
				age: 1000,
				value: "test-value",
				error: "",
			},
			description: {
				display_name: "Test Metric",
				key: "test_metric",
				script: "echo 'test'",
				interval: 60,
				timeout: 30,
			},
		};

		const result = AgentMetadataEventSchema.safeParse(validEvent);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(validEvent);
		}
	});

	it("should reject event with missing result fields", () => {
		const invalidEvent = {
			result: {
				collected_at: "2023-01-01T00:00:00Z",
				age: 1000,
				// missing value and error
			},
			description: {
				display_name: "Test Metric",
				key: "test_metric",
				script: "echo 'test'",
				interval: 60,
				timeout: 30,
			},
		};

		const result = AgentMetadataEventSchema.safeParse(invalidEvent);
		expect(result.success).toBe(false);
	});

	it("should reject event with missing description fields", () => {
		const invalidEvent = {
			result: {
				collected_at: "2023-01-01T00:00:00Z",
				age: 1000,
				value: "test-value",
				error: "",
			},
			description: {
				display_name: "Test Metric",
				key: "test_metric",
				// missing script, interval, timeout
			},
		};

		const result = AgentMetadataEventSchema.safeParse(invalidEvent);
		expect(result.success).toBe(false);
	});

	it("should reject event with wrong data types", () => {
		const invalidEvent = {
			result: {
				collected_at: "2023-01-01T00:00:00Z",
				age: "not-a-number", // should be number
				value: "test-value",
				error: "",
			},
			description: {
				display_name: "Test Metric",
				key: "test_metric",
				script: "echo 'test'",
				interval: 60,
				timeout: 30,
			},
		};

		const result = AgentMetadataEventSchema.safeParse(invalidEvent);
		expect(result.success).toBe(false);
	});
});

describe("AgentMetadataEventSchemaArray", () => {
	it("should validate array of valid events", () => {
		const validEvents = [
			{
				result: {
					collected_at: "2023-01-01T00:00:00Z",
					age: 1000,
					value: "test-value-1",
					error: "",
				},
				description: {
					display_name: "Test Metric 1",
					key: "test_metric_1",
					script: "echo 'test1'",
					interval: 60,
					timeout: 30,
				},
			},
			{
				result: {
					collected_at: "2023-01-01T00:00:00Z",
					age: 2000,
					value: "test-value-2",
					error: "",
				},
				description: {
					display_name: "Test Metric 2",
					key: "test_metric_2",
					script: "echo 'test2'",
					interval: 120,
					timeout: 60,
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
					collected_at: "2023-01-01T00:00:00Z",
					age: 1000,
					value: "test-value-1",
					error: "",
				},
				description: {
					display_name: "Test Metric 1",
					key: "test_metric_1",
					script: "echo 'test1'",
					interval: 60,
					timeout: 30,
				},
			},
			{
				result: {
					collected_at: "2023-01-01T00:00:00Z",
					age: "invalid", // wrong type
					value: "test-value-2",
					error: "",
				},
				description: {
					display_name: "Test Metric 2",
					key: "test_metric_2",
					script: "echo 'test2'",
					interval: 120,
					timeout: 60,
				},
			},
		];

		const result = AgentMetadataEventSchemaArray.safeParse(invalidEvents);
		expect(result.success).toBe(false);
	});
});
